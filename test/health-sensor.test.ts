import * as hap from '@homebridge/hap-nodejs';
import type { PlatformAccessory } from 'homebridge';
import { describe, expect, it } from 'vitest';
import { HealthSensorAccessory } from '../src/accessories/health-sensor.js';
import type { HealthMonitorPlatform } from '../src/platform.js';

describe('HealthSensorAccessory with real HAP services', () => {
  it.each([
    ['leak', hap.Service.LeakSensor, hap.Characteristic.LeakDetected],
    ['contact', hap.Service.ContactSensor, hap.Characteristic.ContactSensorState],
  ] as const)('publishes and resets the %s state independently of fault status', (type, sensorService, detection) => {
    const accessory = new hap.Accessory('Health', hap.uuid.generate('health-test')) as unknown as PlatformAccessory;
    const platform = { api: { hap } } as unknown as HealthMonitorPlatform;
    const sensor = new HealthSensorAccessory(platform, accessory, 'Health', 'health-leak-sensor', type);
    const service = accessory.getService(sensorService);
    expect(service).toBeDefined();
    const value = (characteristic: hap.WithUUID<new () => hap.Characteristic>) => service?.getCharacteristic(characteristic)?.value;
    expect(value(detection)).toBe(0);
    expect(value(hap.Characteristic.StatusActive)).toBe(false);
    expect(value(hap.Characteristic.StatusFault)).toBe(1);
    sensor.update(true, 'OPERATIONAL');
    expect(value(detection)).toBe(1);
    expect(value(hap.Characteristic.StatusFault)).toBe(0);
    expect(value(hap.Characteristic.StatusActive)).toBe(true);
    sensor.update(true, 'UNAVAILABLE');
    expect(value(detection)).toBe(1);
    expect(value(hap.Characteristic.StatusFault)).toBe(1);
    expect(value(hap.Characteristic.StatusActive)).toBe(false);
    sensor.update(false, 'OPERATIONAL');
    expect(value(detection)).toBe(0);
    expect(value(hap.Characteristic.StatusActive)).toBe(true);
    sensor.update(false, 'DISABLED');
    expect(value(hap.Characteristic.StatusActive)).toBe(false);
    expect(value(hap.Characteristic.StatusFault)).toBe(0);
  });
});
