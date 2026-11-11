import { createHash } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import type { NormalizedPlatformConfig } from '../config/types.js';

export type AnomalySeverity = 'error' | 'warning';
export type PluginSeverity = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';

export interface LogAnomaly {
  readonly timestamp: number;
  readonly severity: AnomalySeverity;
  readonly pluginName: string | undefined;
  readonly message: string;
  readonly line: string;
  readonly groupKey?: string;
  readonly occurrences?: number;
  readonly firstOccurrence?: number;
  readonly lastOccurrence?: number;
}

export interface PluginDiagnostic {
  readonly pluginName: string;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly lastError: string | undefined;
  readonly lastOccurrence: number | undefined;
  readonly repeatedErrorCount: number;
  readonly severity: PluginSeverity;
}

export interface HealthSnapshot {
  readonly anomalyCount: number;
  readonly alertActive: boolean;
  readonly anomalies: readonly LogAnomaly[];
  readonly lastAnomaly: LogAnomaly | undefined;
  readonly plugins: readonly PluginDiagnostic[];
}

const LEVEL = /^(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|SUCCESS)$/i;
const SELF = /^(homebridge-health-monitor|healthmonitor|homebridge health monitor)$/i;
const MAX_EVENTS = 10000;
const MAX_PLUGINS = 256;

export class LogAnalyzer {
  private anomalies: LogAnomaly[] = [];
  private readonly plugins = new Map<string, { lastError: string | undefined; lastOccurrence: number | undefined }>();

  public constructor(private readonly config: NormalizedPlatformConfig) {}

  public ingest(line: string, now = Date.now()): LogAnomaly | undefined {
    const parsed = parseLine(line);
    if (!parsed || SELF.test(parsed.pluginName) || parsed.pluginName.toLowerCase() === this.config.name.toLowerCase()) {
      return undefined;
    }
    if (this.plugins.size < MAX_PLUGINS || this.plugins.has(parsed.pluginName)) {
      if (!this.plugins.has(parsed.pluginName)) {
        this.plugins.set(parsed.pluginName, { lastError: undefined, lastOccurrence: undefined });
      }
    } else {
      parsed.pluginName = 'unknown';
      if (!this.plugins.has('unknown')) {
        this.plugins.set('unknown', { lastError: undefined, lastOccurrence: undefined });
      }
    }
    this.prune(now);
    if (!parsed.severity) {
      return undefined;
    }
    // Hash the unredacted message: different credentials/IDs must not silently merge.
    const groupKey = createHash('sha256').update(JSON.stringify([
      parsed.pluginName, parsed.severity, parsed.message.trim(),
    ])).digest('hex');
    const related = this.config.groupRepeatedErrors && parsed.pluginName !== 'unknown' && parsed.severity === 'error'
      ? this.anomalies.filter((item) => item.groupKey === groupKey && item.timestamp >= now - this.config.repeatWindowSeconds * 1000)
      : [];
    const anomaly: LogAnomaly = {
      timestamp: now,
      severity: parsed.severity,
      pluginName: parsed.pluginName,
      message: sanitizeMessage(parsed.message),
      line: '', // Raw log lines are deliberately not retained.
      groupKey,
      occurrences: related.length + 1,
      firstOccurrence: related[0]?.timestamp ?? now,
      lastOccurrence: now,
    };
    const previous = this.plugins.get(parsed.pluginName);
    this.plugins.set(parsed.pluginName, {
      lastError: anomaly.severity === 'error' ? anomaly.message : previous?.lastError,
      lastOccurrence: now,
    });
    this.anomalies.push(anomaly);
    this.prune(now);
    return anomaly;
  }

  public reset(severity?: AnomalySeverity): void {
    this.anomalies = severity ? this.anomalies.filter((item) => item.severity !== severity) : [];
  }

  public snapshot(now = Date.now(), operational = true): HealthSnapshot {
    this.prune(now);
    const recent = this.anomalies.filter((item) => item.timestamp >= now - this.config.analysisWindowSeconds * 1000);
    const counted = recent.filter((item) => item.severity === 'error' || (this.config.monitorWarnings && !this.config.separateWarningSensor));
    const plugins = [...this.plugins.keys()].map((pluginName): PluginDiagnostic => {
      const events = recent.filter((item) => item.pluginName === pluginName);
      const errors = events.filter((item) => item.severity === 'error');
      const groups = new Map<string, number>();
      if (this.config.groupRepeatedErrors && pluginName !== 'unknown') {
        for (const item of this.anomalies) {
          if (item.pluginName === pluginName && item.severity === 'error' && item.groupKey && item.timestamp >= now - this.config.repeatWindowSeconds * 1000) {
            groups.set(item.groupKey, (groups.get(item.groupKey) ?? 0) + 1);
          }
        }
      }
      const repeatedErrorCount = Math.max(0, ...groups.values());
      return {
        pluginName,
        errorCount: errors.length,
        warningCount: events.length - errors.length,
        lastError: this.plugins.get(pluginName)?.lastError,
        lastOccurrence: this.plugins.get(pluginName)?.lastOccurrence,
        repeatedErrorCount: repeatedErrorCount > 1 ? repeatedErrorCount : 0,
        severity: !operational || pluginName === 'unknown' ? 'UNKNOWN'
          : errors.length >= this.config.pluginErrorThreshold || repeatedErrorCount >= this.config.pluginErrorThreshold ? 'CRITICAL'
            : events.length > 0 ? 'WARNING' : 'HEALTHY',
      };
    });
    return {
      anomalyCount: counted.length,
      alertActive: counted.length >= this.config.errorThreshold || plugins.some((plugin) => plugin.severity === 'CRITICAL'),
      anomalies: [...recent],
      lastAnomaly: counted.at(-1),
      plugins,
    };
  }

  private prune(now: number): void {
    const cutoff = now - Math.max(this.config.analysisWindowSeconds, this.config.repeatWindowSeconds) * 1000;
    this.anomalies = this.anomalies.filter((item) => item.timestamp >= cutoff).slice(-MAX_EVENTS);
  }
}

function parseLine(raw: string): { pluginName: string; severity: AnomalySeverity | undefined; message: string } | undefined {
  let rest = stripVTControlCharacters(raw).trim();
  if (!rest) {
    return undefined;
  }
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = /^\[([^\]]+)]\s*/.exec(rest))) {
    tokens.push(match[1] ?? '');
    rest = rest.slice(match[0].length);
    // Only timestamp, source and level prefixes are metadata.
    if (tokens.length >= 3) {
      break;
    }
  }
  const explicit = tokens.find((token) => LEVEL.test(token));
  const bare = /^(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|SUCCESS)(?::|\s+-)\s*/i.exec(rest);
  const level = (explicit ?? bare?.[1])?.toUpperCase();
  if (bare) {
    rest = rest.slice(bare[0].length);
  }
  const candidates = tokens.filter((token) => !LEVEL.test(token) && !/^\d/.test(token) && !/^homebridge$/i.test(token));
  const pluginName = candidates.length === 1 && /^[\w@ .:/-]{1,100}$/.test(candidates[0] ?? '') ? candidates[0] ?? 'unknown' : 'unknown';
  // Homebridge wraps the message (not timestamp/source) in ANSI red/yellow.
  const escape = String.fromCharCode(27);
  const nativeLevel = ['31', '33'].find((color) => {
    const prefix = `${escape}[${color}m`;
    const start = raw.indexOf(prefix);
    if (start < 0) {
      return false;
    }
    const colored = raw.slice(start + prefix.length);
    return (colored.endsWith(`${escape}[39m`) || colored.endsWith(`${escape}[0m`))
      && stripVTControlCharacters(colored).trim() === rest;
  });
  const severity = level === 'ERROR' || (!level && nativeLevel === '31') ? 'error'
    : level === 'WARN' || level === 'WARNING' || (!level && nativeLevel === '33') ? 'warning' : undefined;
  return { pluginName, severity, message: rest };
}

export function sanitizeMessage(message: string): string {
  return stripVTControlCharacters(message)
    .replace(/\b(?:https?|rtsp|mqtts?):\/\/[^\s]+/gi, '[url]')
    .replace(/\b(?:bearer|basic)\s+[^\s,;]+/gi, '[authorization]')
    .replace(/(["']?(?:password|passwd|token|secret|api[_-]?key|authorization|cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .slice(0, 500);
}
