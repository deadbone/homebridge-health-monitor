import type { Logging } from 'homebridge';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { HISTORY_LIMIT } from '../config/defaults.js';
import type { LogAnomaly } from './log-analyzer.js';

export interface StoredAnomaly {
  readonly timestamp: string;
  readonly severity: 'error' | 'warning';
  readonly pluginName: string | undefined;
  readonly message: string;
}

interface HistoryFile {
  readonly schemaVersion: 1;
  readonly anomalies: StoredAnomaly[];
}

export class HistoryStore {
  private anomalies: StoredAnomaly[] = [];
  private loaded = false;

  public constructor(
    private readonly path: string,
    private readonly log: Logging,
    private readonly limit = HISTORY_LIMIT,
  ) {}

  public async add(anomaly: LogAnomaly): Promise<void> {
    await this.load();
    this.anomalies.push({
      timestamp: new Date(anomaly.timestamp).toISOString(),
      severity: anomaly.severity,
      pluginName: anomaly.pluginName,
      message: anomaly.message.slice(0, 500),
    });
    this.anomalies = this.anomalies.slice(-this.limit);
    await this.save();
  }

  public async load(): Promise<readonly StoredAnomaly[]> {
    if (this.loaded) {
      return this.anomalies;
    }
    this.loaded = true;

    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      this.anomalies = parseHistory(parsed).slice(-this.limit);
    } catch (error) {
      if (isMissingFile(error)) {
        this.anomalies = [];
        return this.anomalies;
      }
      this.log.warn('Health Monitor could not load anomaly history: %s', errorMessage(error));
      this.anomalies = [];
    }
    return this.anomalies;
  }

  private async save(): Promise<void> {
    const file: HistoryFile = {
      schemaVersion: 1,
      anomalies: this.anomalies,
    };
    const tempPath = `${this.path}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.path);
  }
}

function parseHistory(value: unknown): StoredAnomaly[] {
  if (!isHistoryFile(value)) {
    return [];
  }
  return value.anomalies.filter(isStoredAnomaly);
}

function isHistoryFile(value: unknown): value is HistoryFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 1 &&
    'anomalies' in value &&
    Array.isArray(value.anomalies)
  );
}

function isStoredAnomaly(value: unknown): value is StoredAnomaly {
  return (
    typeof value === 'object' &&
    value !== null &&
    'timestamp' in value &&
    typeof value.timestamp === 'string' &&
    'severity' in value &&
    (value.severity === 'error' || value.severity === 'warning') &&
    'message' in value &&
    typeof value.message === 'string' &&
    (!('pluginName' in value) || value.pluginName === undefined || typeof value.pluginName === 'string')
  );
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
