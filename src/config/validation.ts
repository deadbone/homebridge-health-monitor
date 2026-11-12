import type { PlatformConfig } from 'homebridge';
import { join } from 'node:path';
import {
  DEFAULT_ANALYSIS_WINDOW_SECONDS,
  DEFAULT_ERROR_THRESHOLD,
  DEFAULT_MONITOR_WARNINGS,
  DEFAULT_PLATFORM_NAME,
  DEFAULT_RESET_AFTER_SECONDS,
  DEFAULT_SCAN_INTERVAL_SECONDS,
} from './defaults.js';
import type { NormalizedPlatformConfig, SensorType } from './types.js';

export class ConfigValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export function normalizeConfig(config: PlatformConfig, storagePath: string): NormalizedPlatformConfig {
  const logFile = readOptionalString(config.logFile, 'logFile') ?? join(storagePath, 'homebridge.log');

  return {
    name: readOptionalString(config.name, 'name') ?? DEFAULT_PLATFORM_NAME,
    logFile,
    scanIntervalSeconds: readInteger(config.scanIntervalSeconds, 'scanIntervalSeconds', DEFAULT_SCAN_INTERVAL_SECONDS, 1, 3600),
    analysisWindowSeconds: readInteger(config.analysisWindowSeconds, 'analysisWindowSeconds', DEFAULT_ANALYSIS_WINDOW_SECONDS, 10, 86400),
    resetAfterSeconds: readInteger(config.resetAfterSeconds, 'resetAfterSeconds', DEFAULT_RESET_AFTER_SECONDS, 10, 86400),
    errorThreshold: readInteger(config.errorThreshold, 'errorThreshold', DEFAULT_ERROR_THRESHOLD, 1, 10000),
    monitorWarnings: readBoolean(config.monitorWarnings, 'monitorWarnings', DEFAULT_MONITOR_WARNINGS),
    debug: readBoolean(config.debug, 'debug', false),
    groupRepeatedErrors: readBoolean(config.groupRepeatedErrors, 'groupRepeatedErrors', true),
    repeatWindowSeconds: readInteger(config.repeatWindowSeconds, 'repeatWindowSeconds', 120, 10, 86400),
    pluginErrorThreshold: readInteger(config.pluginErrorThreshold, 'pluginErrorThreshold', 15, 1, 10000),
    reconnectIntervalSeconds: readInteger(config.reconnectIntervalSeconds, 'reconnectIntervalSeconds', 10, 1, 3600),
    separateWarningSensor: readBoolean(config.separateWarningSensor, 'separateWarningSensor', false),
    errorSensorType: readSensorType(config.errorSensorType, 'errorSensorType'),
    warningSensorType: readSensorType(config.warningSensorType, 'warningSensorType'),
    warningThreshold: readInteger(config.warningThreshold, 'warningThreshold', 5, 1, 10000),
    historyLimit: readInteger(config.historyLimit, 'historyLimit', 50, 1, 1000),
  };
}

function readSensorType(value: unknown, fieldName: string): SensorType {
  if (value === undefined) {
    return 'contact';
  }
  if (value !== 'contact' && value !== 'leak') {
    throw new ConfigValidationError(`Health Monitor configuration field "${fieldName}" must be "contact" or "leak".`);
  }
  return value;
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConfigValidationError(`Health Monitor configuration field "${fieldName}" must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readString(value, fieldName);
}

function readBoolean(value: unknown, fieldName: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new ConfigValidationError(`Health Monitor configuration field "${fieldName}" must be a boolean.`);
  }
  return value;
}

function readInteger(value: unknown, fieldName: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConfigValidationError(
      `Health Monitor configuration field "${fieldName}" must be an integer between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
  return value;
}
