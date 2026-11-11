import * as hap from '@homebridge/hap-nodejs';
import type { PlatformAccessory } from 'homebridge';
import { describe, expect, it } from 'vitest';
import { HealthLeakSensorAccessory } from '../src/accessories/health-leak-sensor.js';
import type { HealthMonitorPlatform } from '../src/platform.js';

describe('HealthLeakSensorAccessory with real HAP services', () => {
  it('exposes only boolean/enumerated status, with fault independent of anomaly alert', () => {
    const accessory = new hap.Accessory('Health', hap.uuid.generate('health-test')) as unknown as PlatformAccessory;
    const platform = { api: { hap } } as unknown as HealthMonitorPlatform;
    const sensor = new HealthLeakSensorAccessory(platform, accessory, 'Health');
    const service = accessory.getService(hap.Service.LeakSensor);
    expect(service).toBeDefined();
    const value = (characteristic: typeof hap.Characteristic.LeakDetected | typeof hap.Characteristic.StatusActive | typeof hap.Characteristic.StatusFault) => service?.getCharacteristic(characteristic).value;
    expect(value(hap.Characteristic.StatusActive)).toBe(false);
    expect(value(hap.Characteristic.StatusFault)).toBe(1);
    sensor.update(true, 'OPERATIONAL');
    expect(value(hap.Characteristic.LeakDetected)).toBe(1);
    expect(value(hap.Characteristic.StatusFault)).toBe(0);
    expect(value(hap.Characteristic.StatusActive)).toBe(true);
    sensor.update(true, 'UNAVAILABLE');
    expect(value(hap.Characteristic.LeakDetected)).toBe(1);
    expect(value(hap.Characteristic.StatusFault)).toBe(1);
    expect(value(hap.Characteristic.StatusActive)).toBe(false);
    sensor.update(false, 'DISABLED');
    expect(value(hap.Characteristic.LeakDetected)).toBe(0);
    expect(value(hap.Characteristic.StatusActive)).toBe(false);
    expect(value(hap.Characteristic.StatusFault)).toBe(0);
  });
});
