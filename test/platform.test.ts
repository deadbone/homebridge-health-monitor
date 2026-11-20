import type { Accessory } from '@homebridge/hap-nodejs';
import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
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

  it('clears cached alarms and rejects cached test switch requests when disabled', async () => {
    const hap = await import('@homebridge/hap-nodejs');
    const api = { ...makeApi(), hap } as API;
    const platform = new HealthMonitorPlatform(makeLog(), { platform: 'HealthMonitor', errorThreshold: 0 }, api);
    const sensor = new hap.Accessory('Cached warning sensor', hap.uuid.generate('warning-sensor'));
    const contact = sensor.addService(hap.Service.ContactSensor);
    contact.updateCharacteristic(hap.Characteristic.ContactSensorState, hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    contact.updateCharacteristic(hap.Characteristic.StatusActive, true);
    contact.updateCharacteristic(hap.Characteristic.StatusFault, hap.Characteristic.StatusFault.GENERAL_FAULT);
    const testSwitch = new hap.Accessory('Cached test switch', hap.uuid.generate('test-switch'));
    const on = testSwitch.addService(hap.Service.Switch).getCharacteristic(hap.Characteristic.On);
    on.updateValue(true);

    platform.configureAccessory(Object.assign(sensor, { context: { role: 'health-warning-sensor' } }) as unknown as PlatformAccessory);
    platform.configureAccessory(Object.assign(testSwitch, { context: { role: 'health-warning-test-switch' } }) as unknown as PlatformAccessory);

    expect(contact.getCharacteristic(hap.Characteristic.ContactSensorState).value).toBe(hap.Characteristic.ContactSensorState.CONTACT_DETECTED);
    expect(contact.getCharacteristic(hap.Characteristic.StatusActive).value).toBe(false);
    expect(contact.getCharacteristic(hap.Characteristic.StatusFault).value).toBe(hap.Characteristic.StatusFault.NO_FAULT);
    expect(sensor.getService(hap.Service.LeakSensor)).toBeUndefined();
    expect(on.value).toBe(false);
    await expect(on.handleSetRequest(true)).rejects.toBe(hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
    expect(on.value).toBe(false);
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
      getService: vi.fn((service: unknown) => (service === 'AccessoryInformation' ? infoService : leakService)),
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
    const platform = new HealthMonitorPlatform(log, { platform: 'HealthMonitor', errorSensorType: 'leak' }, api);

    platform.configureAccessory(expectedAccessory);
    platform.configureAccessory(staleAccessory);

    handlers.get('didFinishLaunching')?.();

    expect(api.updatePlatformAccessories).toHaveBeenCalledWith([expectedAccessory]);
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith('homebridge-health-monitor', 'HealthMonitor', [staleAccessory]);
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
  });
});

describe('HomeKit test switches', () => {
  it('restores or adds both opt-in switches, resets them after use, and removes them when disabled', async () => {
    const hap = await import('@homebridge/hap-nodejs');
    const { HealthMonitor } = await import('../src/services/health-monitor.js');
    const start = vi.spyOn(HealthMonitor.prototype, 'start').mockImplementation(() => undefined);
    const runTest = vi.spyOn(HealthMonitor.prototype, 'runTest').mockReturnValue(true);
    const handlers = new Map<string, () => void>();
    class NewAccessory extends hap.Accessory {
      public context = {};
    }
    const api = {
      user: { storagePath: () => '/tmp/homebridge' },
      hap,
      on: (event: string, handler: () => void) => handlers.set(event, handler),
      platformAccessory: NewAccessory,
      registerPlatformAccessories: vi.fn(),
      updatePlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
    } as unknown as API;
    const cachedError = new NewAccessory('Old Test ERROR', hap.uuid.generate('homebridge-health-monitor:health-error-test-switch'));
    cachedError.addService(hap.Service.Switch).updateCharacteristic(hap.Characteristic.On, true);
    vi.useFakeTimers();
    try {
      const platform = new HealthMonitorPlatform(makeLog(), { platform: 'HealthMonitor', exposeTestSwitches: true }, api);
      platform.configureAccessory(cachedError as unknown as PlatformAccessory);
      handlers.get('didFinishLaunching')?.();
      const switches = [...platform.accessories.values()].filter((accessory) => accessory.getService(hap.Service.Switch));
      expect(switches.map((accessory) => accessory.displayName)).toEqual(['Test ERROR', 'Test WARN']);
      expect(api.updatePlatformAccessories).toHaveBeenCalledWith([cachedError]);
      expect(runTest).not.toHaveBeenCalled();

      for (const [name, severity] of [['Test ERROR', 'error'], ['Test WARN', 'warning']] as const) {
        const on = switches.find((accessory) => accessory.displayName === name)
          ?.getService(hap.Service.Switch)?.getCharacteristic(hap.Characteristic.On);
        if (!on) {
          throw new Error(`Missing On characteristic for ${name}`);
        }
        expect(on.value).toBe(false);
        runTest.mockReturnValueOnce(false);
        await expect(on.handleSetRequest(true)).rejects.toBe(hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
        expect(on.value).toBe(false);
        runTest.mockClear();

        await on.handleSetRequest(true);
        expect(runTest).toHaveBeenCalledWith(severity);
        expect(on.value).toBe(true);
        await vi.advanceTimersByTimeAsync(1000);
        expect(on.value).toBe(false);
        await on.handleSetRequest(false);
        expect(runTest).toHaveBeenCalledOnce();
      }

      const disabled = new HealthMonitorPlatform(makeLog(), { platform: 'HealthMonitor', exposeTestSwitches: false }, api);
      for (const accessory of platform.accessories.values()) {
        disabled.configureAccessory(accessory);
      }
      vi.mocked(api.registerPlatformAccessories).mockClear();
      handlers.get('didFinishLaunching')?.();
      const removed = vi.mocked(api.unregisterPlatformAccessories).mock.calls.flatMap(([, , accessories]) => accessories);
      expect(removed).toEqual(switches);
      expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      start.mockRestore();
      runTest.mockRestore();
    }
  });
});

describe('sensor registration on upgrade', () => {
  it.each([
    ['keep both leak sensors', true, 'leak', 'leak', false, false],
    ['replace only the warning sensor', true, 'leak', 'contact', false, true],
    ['replace only the main sensor', true, 'contact', 'leak', true, false],
    ['replace both sensors by default', true, undefined, undefined, true, true],
    ['skip the optional warning sensor', false, 'leak', 'contact', false, false],
  ] as const)('%s', async (_case, separateWarningSensor, errorSensorType, warningSensorType, replaceMain, replaceWarning) => {
    const hap = await import('@homebridge/hap-nodejs');
    const { HealthMonitor } = await import('../src/services/health-monitor.js');
    const start = vi.spyOn(HealthMonitor.prototype, 'start').mockImplementation(() => undefined);
    const handlers = new Map<string, () => void>();
    const existing = new hap.Accessory('Existing', hap.uuid.generate('homebridge-health-monitor:health-leak-sensor'));
    const warning = new hap.Accessory('Warnings', hap.uuid.generate('homebridge-health-monitor:health-warning-sensor'));
    const cached = (accessory: Accessory) => Object.assign(accessory, { context: {} }) as unknown as PlatformAccessory;
    class NewAccessory extends hap.Accessory {
      public context = {};
    }
    const register = vi.fn<(plugin: string, platform: string, accessories: Accessory[]) => void>();
    const api = {
      user: { storagePath: () => '/tmp/homebridge' },
      hap,
      on: (event: string, handler: () => void) => handlers.set(event, handler),
      platformAccessory: NewAccessory,
      registerPlatformAccessories: register,
      updatePlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
    } as unknown as API;
    try {
      existing.addService(hap.Service.LeakSensor);
      warning.addService(hap.Service.LeakSensor);
      const platform = new HealthMonitorPlatform(makeLog(), { platform: 'HealthMonitor', separateWarningSensor, errorSensorType, warningSensorType }, api);
      platform.configureAccessory(cached(existing));
      platform.configureAccessory(cached(warning));
      handlers.get('didFinishLaunching')?.();
      expect(start).toHaveBeenCalledOnce();
      const replacements = register.mock.calls.flatMap(([, , accessories]) => accessories);
      const replacementRoles = [
        ...(replaceMain ? ['health-leak-sensor'] : []),
        ...(replaceWarning ? ['health-warning-sensor'] : []),
      ];
      expect(replacements.map(({ UUID }) => UUID)).toEqual(replacementRoles.map((role) => hap.uuid.generate(`homebridge-health-monitor:${role}:contact`)));
      for (const replacement of replacements) {
        expect(replacement.getService(hap.Service.ContactSensor)?.getCharacteristic(hap.Characteristic.ContactSensorState).value).toBe(0);
        expect(replacement.getService(hap.Service.LeakSensor)).toBeUndefined();
      }
      const removed = vi.mocked(api.unregisterPlatformAccessories).mock.calls.flatMap(([, , accessories]) => accessories);
      expect(removed).toEqual([
        ...(replaceMain ? [existing] : []),
        ...(!separateWarningSensor || replaceWarning ? [warning] : []),
      ]);
      const reused = vi.mocked(api.updatePlatformAccessories).mock.calls.flatMap(([accessories]) => accessories);
      expect(reused).toEqual([
        ...(!replaceMain ? [existing] : []),
        ...(separateWarningSensor && !replaceWarning ? [warning] : []),
      ]);
    } finally {
      start.mockRestore();
    }
  });
});
