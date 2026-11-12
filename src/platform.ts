import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { join } from 'node:path';
import { HealthSensorAccessory } from './accessories/health-sensor.js';
import { HISTORY_FILE_NAME } from './config/defaults.js';
import { ConfigValidationError, normalizeConfig } from './config/validation.js';
import type { NormalizedPlatformConfig, SensorType } from './config/types.js';
import { HealthMonitor } from './services/health-monitor.js';
import { HistoryStore } from './services/history-store.js';
import { ACCESSORY_DISPLAY_NAME, ACCESSORY_UUID_NAMESPACE, PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

const ACCESSORY_ROLE = 'health-leak-sensor';
const WARNING_ROLE = 'health-warning-sensor';

export class HealthMonitorPlatform implements DynamicPlatformPlugin {
  public readonly accessories = new Map<string, PlatformAccessory>();
  public readonly configData: NormalizedPlatformConfig | undefined;
  private warningSensor: HealthSensorAccessory | undefined;
  private sensor: HealthSensorAccessory | undefined;
  private readonly monitor: HealthMonitor | undefined;

  public constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    const storagePath = this.resolveStoragePath();
    if (!storagePath) {
      return;
    }

    try {
      this.configData = normalizeConfig(config, storagePath);
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        log.error(error.message);
      } else {
        log.error('Health Monitor configuration could not be loaded: %s', errorMessage(error));
      }
      log.warn('Health Monitor is disabled until its configuration is corrected.');
      return;
    }

    const history = new HistoryStore(join(storagePath, HISTORY_FILE_NAME), log, this.configData.historyLimit);
    this.monitor = new HealthMonitor(this.configData, log, history);
    this.monitor.onStatus((status) => {
      this.sensor?.update(status.active, status.monitoring);
    });
    this.monitor.onStatus((status) => {
      this.warningSensor?.update(status.warningActive, status.monitoring);
    });

    this.api.on('didFinishLaunching', () => {
      if (!this.monitor) {
        return;
      }
      try {
        this.registerConfiguredAccessories();
        this.monitor.start();
      } catch (error) {
        this.log.error('Health Monitor failed to start: %s', errorMessage(error));
        void this.monitor.stop();
      }
    });
    this.api.on('shutdown', () => {
      void this.monitor?.stop();
    });
  }

  public configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache: %s', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
    if (!this.configData) {
      try {
        const { Service } = this.api.hap;
        const type = accessory.getService(Service.ContactSensor) ? 'contact' : 'leak';
        const role = accessory.context.role === WARNING_ROLE ? WARNING_ROLE : ACCESSORY_ROLE;
        const sensor = new HealthSensorAccessory(this, accessory, accessory.displayName, role, type);
        sensor.update(false, 'DISABLED');
      } catch (error) {
        this.log.error('Health Monitor failed to restore a disabled accessory: %s', errorMessage(error));
      }
    }
  }

  private registerConfiguredAccessories(): void {
    if (!this.configData) {
      return;
    }
    const expectedAccessory = this.registerSensor(ACCESSORY_ROLE, ACCESSORY_DISPLAY_NAME, this.configData.errorSensorType);
    const expectedUUIDs = new Set([expectedAccessory.UUID]);
    if (this.configData.separateWarningSensor) {
      expectedUUIDs.add(this.registerSensor(WARNING_ROLE, 'Homebridge Health Warnings', this.configData.warningSensorType).UUID);
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!expectedUUIDs.has(uuid)) {
        this.log.info('Removing stale accessory from cache: %s', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }

  private resolveStoragePath(): string | undefined {
    try {
      return this.api.user.storagePath();
    } catch (error) {
      this.log.error('Health Monitor could not resolve the Homebridge storage path: %s', errorMessage(error));
      this.log.warn('Health Monitor is disabled until Homebridge exposes a usable storage path.');
      return undefined;
    }
  }

  private registerSensor(role: string, displayName: string, type: SensorType): PlatformAccessory {
    // Keep the legacy UUID for explicitly configured leak sensors.
    const uuid = this.api.hap.uuid.generate(`${ACCESSORY_UUID_NAMESPACE}:${role}${type === 'contact' ? ':contact' : ''}`);
    const existingAccessory = this.accessories.get(uuid);
    const accessory = existingAccessory ?? new this.api.platformAccessory(displayName, uuid);
    accessory.displayName = displayName;
    accessory.context.role = role;
    const sensor = new HealthSensorAccessory(this, accessory, displayName, role, type);

    if (!existingAccessory) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    } else {
      this.api.updatePlatformAccessories([accessory]);
    }

    if (role === ACCESSORY_ROLE) {
      this.sensor = sensor;
    } else {
      this.warningSensor = sensor;
    }
    return accessory;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
