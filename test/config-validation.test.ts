import { describe, expect, it } from 'vitest';
import { ConfigValidationError, normalizeConfig } from '../src/config/validation.js';

describe('normalizeConfig', () => {
  it('fills defaults and resolves the default log file from storage', () => {
    const config = normalizeConfig(
      {
        platform: 'HealthMonitor',
      },
      '/var/lib/homebridge',
    );

    expect(config).toEqual({
      name: 'Homebridge Health Monitor',
      logFile: '/var/lib/homebridge/homebridge.log',
      scanIntervalSeconds: 5,
      analysisWindowSeconds: 300,
      resetAfterSeconds: 600,
      errorThreshold: 3,
      monitorWarnings: false,
      debug: false,
    });
  });

  it('trims string fields and preserves explicit values', () => {
    const config = normalizeConfig(
      {
        platform: 'HealthMonitor',
        name: '  Health  ',
        logFile: '  /tmp/homebridge.log  ',
        scanIntervalSeconds: 2,
        analysisWindowSeconds: 60,
        resetAfterSeconds: 120,
        errorThreshold: 4,
        monitorWarnings: true,
        debug: true,
      },
      '/var/lib/homebridge',
    );

    expect(config).toMatchObject({
      name: 'Health',
      logFile: '/tmp/homebridge.log',
      scanIntervalSeconds: 2,
      analysisWindowSeconds: 60,
      resetAfterSeconds: 120,
      errorThreshold: 4,
      monitorWarnings: true,
      debug: true,
    });
  });

  it('rejects invalid strings, booleans, and integer ranges', () => {
    expect(() => normalizeConfig({ platform: 'HealthMonitor', name: '' }, '/tmp')).toThrow(ConfigValidationError);
    expect(() => normalizeConfig({ platform: 'HealthMonitor', monitorWarnings: 'yes' }, '/tmp')).toThrow(ConfigValidationError);
    expect(() => normalizeConfig({ platform: 'HealthMonitor', errorThreshold: 0 }, '/tmp')).toThrow(ConfigValidationError);
    expect(() => normalizeConfig({ platform: 'HealthMonitor', scanIntervalSeconds: 1.5 }, '/tmp')).toThrow(ConfigValidationError);
  });
});
