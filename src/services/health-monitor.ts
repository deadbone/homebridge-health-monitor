import type { Logging } from 'homebridge';
import type { NormalizedPlatformConfig } from '../config/types.js';
import { LogAnalyzer, type HealthSnapshot, type LogAnomaly } from './log-analyzer.js';
import { HistoryStore } from './history-store.js';
import { LogTail } from './log-tail.js';

export type MonitoringState = 'OPERATIONAL' | 'UNAVAILABLE' | 'DISABLED' | 'RECONNECTING';
export interface HealthStatus {
  readonly active: boolean;
  readonly warningActive: boolean;
  readonly monitoring: MonitoringState;
  readonly snapshot: HealthSnapshot;
}
export type StatusListener = (status: HealthStatus) => void;

export class HealthMonitor {
  private readonly analyzer: LogAnalyzer;
  private readonly tail: LogTail;
  private readonly listeners: StatusListener[] = [];
  private pollTimer: NodeJS.Timeout | undefined;
  private task: Promise<void> = Promise.resolve();
  private generation = 0;
  private running = false;
  private active = false;
  private warningActive = false;
  private lastCountedAt: number | undefined;
  private lastWarningAt: number | undefined;
  private monitoring: MonitoringState = 'DISABLED';
  private readFailed = false;
  private historyFailed = false;

  public constructor(private readonly config: NormalizedPlatformConfig, private readonly log: Logging, private readonly history: HistoryStore) {
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
    const generation = ++this.generation;
    this.task = this.task.then(() => this.initialize(generation));
  }

  public stop(): Promise<void> {
    this.running = false;
    this.generation++;
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.monitoring = 'DISABLED';
    this.emit();
    this.task = this.task.then(() => this.tail.close()).catch(() => {
      this.log.debug('Health Monitor failed to close log file.');
    });
    return this.task;
  }

  private current(generation: number): boolean {
    return this.running && this.generation === generation;
  }

  private async initialize(generation: number): Promise<void> {
    if (!this.current(generation)) {
      return;
    }
    this.analyzer.reset();
    this.active = false;
    this.warningActive = false;
    this.lastCountedAt = undefined;
    this.lastWarningAt = undefined;
    this.monitoring = 'RECONNECTING';
    this.emit();
    try {
      await this.history.load();
    } catch (error) {
      this.log.warn('Health Monitor could not initialize anomaly history: %s', String(error));
    }
    if (!this.current(generation)) {
      return;
    }
    try {
      await this.tail.openAtEnd();
      if (!this.current(generation)) {
        return;
      }
      this.log.info('Health Monitor started watching %s', this.config.logFile);
      this.monitoring = 'OPERATIONAL';
      this.readFailed = false;
      this.emit();
    } catch {
      if (this.current(generation)) {
        this.unavailable();
      }
    }
    this.schedule(generation);
  }

  private schedule(generation: number): void {
    if (!this.current(generation)) {
      return;
    }
    let seconds = this.monitoring === 'OPERATIONAL' ? this.config.scanIntervalSeconds : this.config.reconnectIntervalSeconds;
    if (this.monitoring === 'OPERATIONAL') {
      for (const timestamp of [this.lastCountedAt, this.lastWarningAt]) {
        if (timestamp !== undefined) {
          const remaining = this.config.resetAfterSeconds - (Date.now() - timestamp) / 1000;
          if (remaining > 0) {
            seconds = Math.min(seconds, remaining);
          }
        }
      }
    }
    this.pollTimer = setTimeout(() => {
      this.task = this.poll(generation);
    }, seconds * 1000);
  }

  private async poll(generation: number): Promise<void> {
    try {
      if (this.readFailed) {
        this.monitoring = 'RECONNECTING';
        this.emit();
      }
      const lines = await this.tail.readNewLines();
      if (!this.current(generation)) {
        return;
      }
      if (this.readFailed) {
        this.log.info('Health Monitor log monitoring restored.');
      }
      this.readFailed = false;
      this.monitoring = 'OPERATIONAL';
      const anomalies: LogAnomaly[] = [];
      for (const line of lines) {
        const anomaly = this.analyzer.ingest(line);
        if (!anomaly) {
          continue;
        }
        if (anomaly.severity === 'error' || (this.config.monitorWarnings && !this.config.separateWarningSensor)) {
          this.lastCountedAt = anomaly.timestamp;
        }
        if (anomaly.severity === 'warning') {
          this.lastWarningAt = anomaly.timestamp;
        }
        anomalies.push(anomaly);
      }
      this.updateAlerts();
      if (anomalies.length > 0 || this.historyFailed) {
        try {
          await this.history.addMany(anomalies);
          if (this.historyFailed) {
            this.log.info('Health Monitor history storage restored.');
          }
          this.historyFailed = false;
        } catch {
          if (!this.historyFailed) {
            this.log.warn('Health Monitor cannot save anomaly history; log monitoring continues.');
          }
          this.historyFailed = true;
        }
      }
    } catch {
      if (this.current(generation)) {
        this.unavailable();
      }
    } finally {
      this.schedule(generation);
    }
  }

  private unavailable(): void {
    if (!this.readFailed) {
      this.log.warn('Health Monitor log monitoring unavailable; reconnecting automatically.');
    }
    this.readFailed = true;
    this.monitoring = 'UNAVAILABLE';
    // Do not reset an alert while observations are unavailable.
    this.emit();
  }

  private updateAlerts(): void {
    const now = Date.now();
    const snapshot = this.analyzer.snapshot(now);
    const quiet = this.lastCountedAt !== undefined && now - this.lastCountedAt >= this.config.resetAfterSeconds * 1000;
    if (quiet) {
      if (this.active) {
        this.log.info('Health Monitor alert reset after %d second(s) without a new anomaly.', this.config.resetAfterSeconds);
      }
      this.active = false;
      this.analyzer.reset('error');
      if (this.config.monitorWarnings && !this.config.separateWarningSensor) {
        this.analyzer.reset('warning');
      }
      this.lastCountedAt = undefined;
    } else if (snapshot.alertActive && !this.active) {
      this.active = true;
      this.log.warn('Health Monitor anomaly alert active.');
    }
    const warningQuiet = this.lastWarningAt !== undefined && now - this.lastWarningAt >= this.config.resetAfterSeconds * 1000;
    if (warningQuiet) {
      if (this.warningActive) {
        this.log.info('Health Monitor warning alert reset after the quiet period.');
      }
      this.warningActive = false;
      this.analyzer.reset('warning');
      this.lastWarningAt = undefined;
    } else if (this.config.separateWarningSensor && snapshot.anomalies.filter((item) => item.severity === 'warning').length >= this.config.warningThreshold) {
      if (!this.warningActive) {
        this.log.warn('Health Monitor warning alert active.');
      }
      this.warningActive = true;
    }
    this.emit();
  }

  private emit(snapshot = this.analyzer.snapshot(Date.now(), this.monitoring === 'OPERATIONAL')): void {
    const status = { active: this.active, warningActive: this.warningActive, monitoring: this.monitoring, snapshot };
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        this.log.error('Health Monitor could not publish sensor status: %s', String(error));
      }
    }
  }
}
