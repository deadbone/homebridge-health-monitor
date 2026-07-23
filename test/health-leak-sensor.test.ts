import type { API, PlatformAccessory, Service } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';
import { HealthLeakSensorAccessory } from '../src/accessories/health-leak-sensor.js';
import type { HealthMonitorPlatform } from '../src/platform.js';

describe('HealthLeakSensorAccessory', () => {
  it('sets accessory information and updates leak/fault state', () => {
    const infoService = {
      setCharacteristic: vi.fn().mockReturnThis(),
    };
    const leakService = {
      setCharacteristic: vi.fn().mockReturnThis(),
      updateCharacteristic: vi.fn().mockReturnThis(),
    };
    const addService = vi.fn(() => leakService);
    const ServiceType = {
      AccessoryInformation: 'AccessoryInformation',
      LeakSensor: 'LeakSensor',
    };
    const Characteristic = {
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
    };
    const accessory = {
      getService: vi.fn((service: Service) => (service === ServiceType.AccessoryInformation ? infoService : undefined)),
      addService,
    } as unknown as PlatformAccessory;
    const platform = {
      api: {
        hap: {
          Characteristic,
          Service: ServiceType,
        },
      } as unknown as API,
    } as HealthMonitorPlatform;

    const sensor = new HealthLeakSensorAccessory(platform, accessory, 'Health');
    sensor.update(true);

    expect(infoService.setCharacteristic).toHaveBeenCalledWith('Manufacturer', 'Thierry Lubrez');
    expect(infoService.setCharacteristic).toHaveBeenCalledWith('Model', 'Homebridge Health Monitor');
    expect(infoService.setCharacteristic).toHaveBeenCalledWith('SerialNumber', 'health-leak-sensor');
    expect(addService).toHaveBeenCalledWith(ServiceType.LeakSensor, 'Health');
    expect(leakService.setCharacteristic).toHaveBeenCalledWith('Name', 'Health');
    expect(leakService.updateCharacteristic).toHaveBeenCalledWith(Characteristic.LeakDetected, 0);
    expect(leakService.updateCharacteristic).toHaveBeenCalledWith(Characteristic.StatusFault, 0);
    expect(leakService.updateCharacteristic).toHaveBeenCalledWith(Characteristic.LeakDetected, 1);
    expect(leakService.updateCharacteristic).toHaveBeenCalledWith(Characteristic.StatusFault, 1);
  });
});
