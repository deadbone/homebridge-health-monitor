import type { NormalizedPlatformConfig } from '../config/types.js';

export type AnomalySeverity = 'error' | 'warning';

export interface LogAnomaly {
  readonly timestamp: number;
  readonly severity: AnomalySeverity;
  readonly pluginName: string | undefined;
  readonly message: string;
  readonly line: string;
}

export interface HealthSnapshot {
  readonly anomalyCount: number;
  readonly alertActive: boolean;
  readonly anomalies: readonly LogAnomaly[];
  readonly lastAnomaly: LogAnomaly | undefined;
}

const LOG_LEVEL_PATTERN = /\[(ERROR|WARN|WARNING)]/i;
const FALLBACK_ERROR_PATTERN = /(^|[\s[\]:-])error([\s\]:-]|$)/i;
const FALLBACK_WARNING_PATTERN = /(^|[\s[\]:-])warn(?:ing)?([\s\]:-]|$)/i;
const SELF_TOKENS = /^(homebridge-health-monitor|healthmonitor|homebridge health monitor)$/i;

export class LogAnalyzer {
  private readonly anomalies: LogAnomaly[] = [];

  public constructor(private readonly config: NormalizedPlatformConfig) {}

  public ingest(line: string, now = Date.now()): LogAnomaly | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || isSelfLog(trimmed)) {
      return undefined;
    }

    const severity = classifySeverity(trimmed, this.config.monitorWarnings);
    if (!severity) {
      return undefined;
    }

    const anomaly: LogAnomaly = {
      timestamp: now,
      severity,
      pluginName: extractPluginName(trimmed),
      message: extractMessage(trimmed),
      line: trimmed,
    };

    this.anomalies.push(anomaly);
    this.prune(now);
    return anomaly;
  }

  public snapshot(now = Date.now()): HealthSnapshot {
    this.prune(now);
    return {
      anomalyCount: this.anomalies.length,
      alertActive: this.anomalies.length >= this.config.errorThreshold,
      anomalies: [...this.anomalies],
      lastAnomaly: this.anomalies.at(-1),
    };
  }

  private prune(now: number): void {
    const cutoff = now - this.config.analysisWindowSeconds * 1000;
    while (this.anomalies.length > 0 && this.anomalies[0]?.timestamp !== undefined && this.anomalies[0].timestamp < cutoff) {
      this.anomalies.shift();
    }
  }
}

function classifySeverity(line: string, monitorWarnings: boolean): AnomalySeverity | undefined {
  const level = line.match(LOG_LEVEL_PATTERN)?.[1]?.toLowerCase();
  if (level === 'error') {
    return 'error';
  }
  if ((level === 'warn' || level === 'warning') && monitorWarnings) {
    return 'warning';
  }
  if (FALLBACK_ERROR_PATTERN.test(line)) {
    return 'error';
  }
  if (monitorWarnings && FALLBACK_WARNING_PATTERN.test(line)) {
    return 'warning';
  }
  return undefined;
}

function isSelfLog(line: string): boolean {
  return [...line.matchAll(/\[([^\]]+)]/g)].some((match) => SELF_TOKENS.test(match[1]?.trim() ?? ''));
}

function extractPluginName(line: string): string | undefined {
  const bracketGroups = [...line.matchAll(/\[([^\]]+)]/g)].map((match) => match[1]?.trim()).filter(isUsefulPluginToken);
  return bracketGroups.at(-1);
}

function extractMessage(line: string): string {
  const withoutPrefixes = line.replace(/^(?:\[[^\]]+]\s*)+/, '').trim();
  return withoutPrefixes.length > 0 ? withoutPrefixes : line.slice(0, 500);
}

function isUsefulPluginToken(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  if (/^\d/.test(value) || /^(error|err|warn|warning|info|debug|homebridge)$/i.test(value)) {
    return false;
  }
  if (SELF_TOKENS.test(value)) {
    return false;
  }
  return true;
}
