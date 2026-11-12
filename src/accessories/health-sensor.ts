import type { Characteristic, PlatformAccessory, Service, WithUUID } from 'homebridge';
import type { SensorType } from '../config/types.js';
import type { MonitoringState } from '../services/health-monitor.js';
import type { HealthMonitorPlatform } from '../platform.js';

export class HealthSensorAccessory {
  private readonly service: Service;
  private readonly detection: WithUUID<new () => Characteristic>;
  private readonly activeValue: number;
  private readonly normalValue: number;

  public constructor(
    private readonly platform: HealthMonitorPlatform,
    private readonly accessory: PlatformAccessory,
    displayName: string,
    role: string,
    type: SensorType,
  ) {
    const { Characteristic, Service } = this.platform.api.hap;
    this.accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'Thierry Lubrez')
      .setCharacteristic(Characteristic.Model, 'Homebridge Health Monitor')
      .setCharacteristic(Characteristic.SerialNumber, role);

    const sensorService = type === 'leak' ? Service.LeakSensor : Service.ContactSensor;
    this.service = this.accessory.getService(sensorService) ?? this.accessory.addService(sensorService, displayName);
    if (type === 'leak') {
      this.detection = Characteristic.LeakDetected;
      this.activeValue = Characteristic.LeakDetected.LEAK_DETECTED;
      this.normalValue = Characteristic.LeakDetected.LEAK_NOT_DETECTED;
    } else {
      this.detection = Characteristic.ContactSensorState;
      this.activeValue = Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
      this.normalValue = Characteristic.ContactSensorState.CONTACT_DETECTED;
    }
    this.service.setCharacteristic(Characteristic.Name, displayName);
    this.update(false, 'RECONNECTING');
  }

  public update(active: boolean, monitoring: MonitoringState = 'OPERATIONAL'): void {
    const { Characteristic } = this.platform.api.hap;
    this.service.updateCharacteristic(
      this.detection,
      active ? this.activeValue : this.normalValue,
    );
    this.service.updateCharacteristic(Characteristic.StatusActive, monitoring === 'OPERATIONAL');
    this.service.updateCharacteristic(
      Characteristic.StatusFault,
      monitoring === 'UNAVAILABLE' || monitoring === 'RECONNECTING' ? Characteristic.StatusFault.GENERAL_FAULT : Characteristic.StatusFault.NO_FAULT,
    );
  }
}
