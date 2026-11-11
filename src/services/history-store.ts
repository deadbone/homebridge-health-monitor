import type { Logging } from 'homebridge';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HISTORY_LIMIT } from '../config/defaults.js';
import { sanitizeMessage, type LogAnomaly } from './log-analyzer.js';

export interface StoredAnomaly {
  readonly timestamp: string;
  readonly severity: 'error' | 'warning';
  readonly pluginName: string;
  readonly message: string;
  readonly occurrences: number;
  readonly firstOccurrence: string;
  readonly lastOccurrence: string;
  readonly groupKey?: string;
}

export class HistoryStore {
  private anomalies: StoredAnomaly[] = [];
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly limit: number;

  public constructor(private readonly path: string, private readonly log: Logging, limit = HISTORY_LIMIT) {
    this.limit = Number.isInteger(limit) ? Math.max(1, Math.min(1000, limit)) : HISTORY_LIMIT;
  }

  public add(anomaly: LogAnomaly): Promise<void> {
    return this.addMany([anomaly]);
  }

  public addMany(anomalies: readonly LogAnomaly[]): Promise<void> {
    return this.serialize(async () => {
      await this.read();
      for (const anomaly of anomalies) {
        const record: StoredAnomaly = {
          timestamp: new Date(anomaly.timestamp).toISOString(),
          severity: anomaly.severity,
          pluginName: sanitizeMessage(anomaly.pluginName ?? 'unknown').slice(0, 100),
          message: sanitizeMessage(anomaly.message),
          occurrences: anomaly.occurrences ?? 1,
          firstOccurrence: new Date(anomaly.firstOccurrence ?? anomaly.timestamp).toISOString(),
          lastOccurrence: new Date(anomaly.lastOccurrence ?? anomaly.timestamp).toISOString(),
          ...(anomaly.groupKey ? { groupKey: anomaly.groupKey } : {}),
        };
        const index = this.anomalies.findIndex((item) => record.occurrences > 1 && item.groupKey === record.groupKey && item.firstOccurrence === record.firstOccurrence);
        if (index >= 0) {
          this.anomalies.splice(index, 1);
        }
        this.anomalies.push(record);
        this.anomalies = this.anomalies.slice(-this.limit);
      }
      await this.save();
    });
  }

  public load(): Promise<readonly StoredAnomaly[]> {
    return this.serialize(async () => {
      await this.read();
      return [...this.anomalies];
    });
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const file = await open(this.path, 'r');
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > 8 * 1024 * 1024) {
          throw new Error('Invalid history size');
        }
        const parsed: unknown = JSON.parse(await file.readFile('utf8'));
        if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.anomalies)) {
          throw new Error('Invalid history format');
        }
        this.anomalies = parsed.anomalies.map(parseRecord).filter((item): item is StoredAnomaly => item !== undefined).slice(-this.limit);
      } finally {
        await file.close();
      }
    } catch (error) {
      if (!(isRecord(error) && error.code === 'ENOENT')) {
        this.log.warn('Health Monitor could not load anomaly history; starting with an empty history.');
      }
      this.anomalies = [];
    }
  }

  private async save(): Promise<void> {
    const tempPath = `${this.path}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const file = await open(tempPath, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify({ schemaVersion: 1, anomalies: this.anomalies }, null, 2)}\n`, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(tempPath, this.path);
    } finally {
      await rm(tempPath, { force: true });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parseRecord(value: unknown): StoredAnomaly | undefined {
  if (!isRecord(value) || !validDate(value.timestamp) || (value.severity !== 'error' && value.severity !== 'warning') || typeof value.message !== 'string') {
    return undefined;
  }
  return {
    timestamp: value.timestamp,
    severity: value.severity,
    pluginName: typeof value.pluginName === 'string' ? sanitizeMessage(value.pluginName).slice(0, 100) : 'unknown',
    message: sanitizeMessage(value.message),
    occurrences: typeof value.occurrences === 'number' && Number.isInteger(value.occurrences) && value.occurrences > 0 ? Math.min(value.occurrences, 10000) : 1,
    firstOccurrence: validDate(value.firstOccurrence) ? value.firstOccurrence : value.timestamp,
    lastOccurrence: validDate(value.lastOccurrence) ? value.lastOccurrence : value.timestamp,
    ...(typeof value.groupKey === 'string' && /^[a-f0-9]{64}$/.test(value.groupKey) ? { groupKey: value.groupKey } : {}),
  };
}
