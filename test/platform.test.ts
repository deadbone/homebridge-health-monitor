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

  it('logs and disables itself instead of throwing when the storage path cannot be resolved', () => {
    const log = makeLog();
    const api = {
      user: {
        storagePath: () => {
          throw new Error('storage unavailable');
        },
      },
      on: vi.fn(),
    } as unknown as API;

    expect(() => new HealthMonitorPlatform(log, { platform: 'HealthMonitor' }, api)).not.toThrow();
    expect(log.error).toHaveBeenCalledWith('Health Monitor could not resolve the Homebridge storage path: %s', 'storage unavailable');
    expect(log.warn).toHaveBeenCalledWith('Health Monitor is disabled until Homebridge exposes a usable storage path.');
    expect(api.on).not.toHaveBeenCalled();
  });

  it('logs startup failures from didFinishLaunching instead of letting them escape', () => {
    const log = makeLog();
    const handlers = new Map<string, () => void>();
    const api = {
      user: {
        storagePath: () => '/tmp/homebridge',
      },
      on: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler);
      }),
      hap: {
        uuid: {
          generate: () => {
            throw new Error('hap unavailable');
          },
        },
      },
    } as unknown as API;

    new HealthMonitorPlatform(log, { platform: 'HealthMonitor' }, api);

    expect(() => handlers.get('didFinishLaunching')?.()).not.toThrow();
    expect(log.error).toHaveBeenCalledWith('Health Monitor failed to start: %s', 'hap unavailable');
  });
});
