import type { API, Logging, PlatformConfig } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';
import { HealthMonitorPlatform } from '../src/platform.js';

function makeLog(): Logging {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logging;
}

function makeApi(): API {
  return {
    user: {
      storagePath: () => '/tmp/homebridge',
    },
    on: vi.fn(),
  } as unknown as API;
}

describe('HealthMonitorPlatform', () => {
  it('logs and disables itself instead of throwing when config is invalid', () => {
    const log = makeLog();
    const api = makeApi();
    const config = {
      platform: 'HealthMonitor',
      errorThreshold: 0,
    } as PlatformConfig;

    expect(() => new HealthMonitorPlatform(log, config, api)).not.toThrow();
    expect(log.error).toHaveBeenCalledWith('Health Monitor configuration field "errorThreshold" must be an integer between 1 and 10000.');
    expect(log.warn).toHaveBeenCalledWith('Health Monitor is disabled until its configuration is corrected.');
    expect(api.on).not.toHaveBeenCalled();
  });
});
