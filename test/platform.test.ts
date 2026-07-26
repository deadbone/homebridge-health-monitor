import type { API, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
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

  it('updates the expected cached accessory and removes stale cached accessories', () => {
    const log = makeLog();
    const handlers = new Map<string, () => void>();
    const infoService = {
      setCharacteristic: vi.fn().mockReturnThis(),
    };
    const leakService = {
      setCharacteristic: vi.fn().mockReturnThis(),
      updateCharacteristic: vi.fn().mockReturnThis(),
    };
    const staleAccessory = {
      UUID: 'stale',
      displayName: 'Stale Health Monitor',
    } as PlatformAccessory;
    const expectedAccessory = {
      UUID: 'expected',
      displayName: 'Cached Health Monitor',
      context: {},
      getService: vi.fn((service: Service) => (service === 'AccessoryInformation' ? infoService : leakService)),
      addService: vi.fn(() => leakService),
    } as unknown as PlatformAccessory;
    const api = {
      user: {
        storagePath: () => '/tmp/homebridge',
      },
      on: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler);
      }),
      hap: {
        uuid: {
          generate: () => 'expected',
        },
        Characteristic: {
          Manufacturer: 'Manufacturer',
          Model: 'Model',
          SerialNumber: 'SerialNumber',
          Name: 'Name',
          LeakDetected: {
            LEAK_DETECTED: 1,
            LEAK_NOT_DETECTED: 0,
          },
          StatusFault: {
            GENERAL_FAULT: 1,
            NO_FAULT: 0,
          },
        },
        Service: {
          AccessoryInformation: 'AccessoryInformation',
          LeakSensor: 'LeakSensor',
        },
      },
      platformAccessory: vi.fn(),
      registerPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
    } as unknown as API;
    const platform = new HealthMonitorPlatform(log, { platform: 'HealthMonitor' }, api);

    platform.configureAccessory(expectedAccessory);
    platform.configureAccessory(staleAccessory);

    handlers.get('didFinishLaunching')?.();

    expect(api.updatePlatformAccessories).toHaveBeenCalledWith([expectedAccessory]);
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith('homebridge-health-monitor', 'HealthMonitor', [staleAccessory]);
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
  });
});
