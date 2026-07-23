import type { Logging } from 'homebridge';
import type { NormalizedPlatformConfig } from '../config/types.js';
import { LogAnalyzer, type HealthSnapshot, type LogAnomaly } from './log-analyzer.js';
import { HistoryStore } from './history-store.js';
import { LogTail } from './log-tail.js';

export interface HealthStatus {
  readonly active: boolean;
  readonly snapshot: HealthSnapshot;
}

export type StatusListener = (status: HealthStatus) => void;

export class HealthMonitor {
  private readonly analyzer: LogAnalyzer;
  private readonly tail: LogTail;
  private listeners: StatusListener[] = [];
  private pollTimer: NodeJS.Timeout | undefined;
  private resetTimer: NodeJS.Timeout | undefined;
  private running = false;
  private active = false;

  public constructor(
    private readonly config: NormalizedPlatformConfig,
    private readonly log: Logging,
    private readonly history: HistoryStore,
  ) {
    this.analyzer = new LogAnalyzer(config);
    this.tail = new LogTail(config.logFile);
  }

  public onStatus(listener: StatusListener): void {
    this.listeners.push(listener);
  }

  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.startPolling();
  }

  public stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.clearResetTimer();
    void this.tail.close().catch((error: unknown) => {
      this.log.debug('Health Monitor failed to close log file: %s', errorMessage(error));
    });
  }

  private async startPolling(): Promise<void> {
    try {
      await this.history.load();
      await this.tail.openAtEnd();
      this.log.info('Health Monitor started watching %s', this.config.logFile);
    } catch (error) {
      this.running = false;
      this.log.warn('Health Monitor cannot read %s: %s. Monitoring is disabled.', this.config.logFile, errorMessage(error));
      this.emit();
      return;
    }

    await this.poll();
    if (!this.running) {
      return;
    }
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.config.scanIntervalSeconds * 1000);
  }

  private async poll(): Promise<void> {
    try {
      const lines = await this.tail.readNewLines();
      const anomalies = lines.map((line) => this.analyzer.ingest(line)).filter((anomaly): anomaly is LogAnomaly => anomaly !== undefined);
      if (anomalies.length > 0 && this.config.debug) {
        this.log.debug('Health Monitor ingested %d anomaly/anomalies.', anomalies.length);
      }
      for (const anomaly of anomalies) {
        await this.history.add(anomaly);
        this.refreshResetTimer();
      }
      this.updateAlertState();
    } catch (error) {
      this.log.warn('Health Monitor cannot read %s: %s', this.config.logFile, errorMessage(error));
    }
  }

  private updateAlertState(): void {
    const snapshot = this.analyzer.snapshot();
    if (snapshot.alertActive && !this.active) {
      const last = snapshot.lastAnomaly;
      this.active = true;
      this.log.warn(
        'Health Monitor alert active: %d anomaly/anomalies in the analysis window%s.',
        snapshot.anomalyCount,
        last?.pluginName ? `; latest source: ${last.pluginName}` : '',
      );
    }
    this.emit(snapshot);
  }

  private refreshResetTimer(): void {
    this.clearResetTimer();
    this.resetTimer = setTimeout(() => {
      this.active = false;
      this.log.info('Health Monitor alert reset after %d second(s) without a new anomaly.', this.config.resetAfterSeconds);
      this.emit();
    }, this.config.resetAfterSeconds * 1000);
  }

  private clearResetTimer(): void {
    if (!this.resetTimer) {
      return;
    }
    clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
  }

  private emit(snapshot = this.analyzer.snapshot()): void {
    for (const listener of this.listeners) {
      listener({
        active: this.active,
        snapshot,
      });
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
