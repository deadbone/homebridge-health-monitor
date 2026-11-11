import type { PlatformAccessory, Service } from 'homebridge';
import type { MonitoringState } from '../services/health-monitor.js';
import type { HealthMonitorPlatform } from '../platform.js';

export class HealthLeakSensorAccessory {
  private readonly service: Service;

  public constructor(
    private readonly platform: HealthMonitorPlatform,
    private readonly accessory: PlatformAccessory,
    displayName: string,
    role = 'health-leak-sensor',
  ) {
    const { Characteristic, Service } = this.platform.api.hap;
    this.accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'Thierry Lubrez')
      .setCharacteristic(Characteristic.Model, 'Homebridge Health Monitor')
      .setCharacteristic(Characteristic.SerialNumber, role);

    this.service = this.accessory.getService(Service.LeakSensor) ?? this.accessory.addService(Service.LeakSensor, displayName);
    this.service.setCharacteristic(Characteristic.Name, displayName);
    this.update(false, 'RECONNECTING');
  }

  public update(active: boolean, monitoring: MonitoringState = 'OPERATIONAL'): void {
    const { Characteristic } = this.platform.api.hap;
    this.service.updateCharacteristic(
      Characteristic.LeakDetected,
      active ? Characteristic.LeakDetected.LEAK_DETECTED : Characteristic.LeakDetected.LEAK_NOT_DETECTED,
    );
    this.service.updateCharacteristic(Characteristic.StatusActive, monitoring === 'OPERATIONAL');
    this.service.updateCharacteristic(
      Characteristic.StatusFault,
      monitoring === 'UNAVAILABLE' || monitoring === 'RECONNECTING' ? Characteristic.StatusFault.GENERAL_FAULT : Characteristic.StatusFault.NO_FAULT,
    );
  }
}
