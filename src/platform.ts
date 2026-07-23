import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { join } from 'node:path';
import { HealthLeakSensorAccessory } from './accessories/health-leak-sensor.js';
import { HISTORY_FILE_NAME } from './config/defaults.js';
import { ConfigValidationError, normalizeConfig } from './config/validation.js';
import type { NormalizedPlatformConfig } from './config/types.js';
import { HealthMonitor } from './services/health-monitor.js';
import { HistoryStore } from './services/history-store.js';
import { ACCESSORY_DISPLAY_NAME, ACCESSORY_UUID_NAMESPACE, PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

const ACCESSORY_ROLE = 'health-leak-sensor';

export class HealthMonitorPlatform implements DynamicPlatformPlugin {
  public readonly accessories = new Map<string, PlatformAccessory>();
  public readonly configData: NormalizedPlatformConfig | undefined;
  private sensor: HealthLeakSensorAccessory | undefined;
  private readonly monitor: HealthMonitor | undefined;

  public constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    const storagePath = api.user.storagePath();
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

    const history = new HistoryStore(join(storagePath, HISTORY_FILE_NAME), log);
    this.monitor = new HealthMonitor(this.configData, log, history);
    this.monitor.onStatus((status) => {
      this.sensor?.update(status.active);
    });

    this.api.on('didFinishLaunching', () => {
      if (!this.monitor) {
        return;
      }
      this.registerConfiguredAccessories();
      this.monitor.start();
    });
    this.api.on('shutdown', () => {
      this.monitor?.stop();
    });
  }

  public configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache: %s', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  private registerConfiguredAccessories(): void {
    const expectedAccessory = this.registerSensor();
    const expectedUUID = expectedAccessory.UUID;

    for (const [uuid, accessory] of this.accessories) {
      if (uuid !== expectedUUID) {
        this.log.info('Removing stale accessory from cache: %s', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }

  private registerSensor(): PlatformAccessory {
    const uuid = this.api.hap.uuid.generate(`${ACCESSORY_UUID_NAMESPACE}:${ACCESSORY_ROLE}`);
    const existingAccessory = this.accessories.get(uuid);
    const accessory = existingAccessory ?? new this.api.platformAccessory(ACCESSORY_DISPLAY_NAME, uuid);
    accessory.displayName = ACCESSORY_DISPLAY_NAME;
    accessory.context.role = ACCESSORY_ROLE;

    if (!existingAccessory) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    } else {
      this.api.updatePlatformAccessories([accessory]);
    }

    this.sensor = new HealthLeakSensorAccessory(this, accessory, ACCESSORY_DISPLAY_NAME);
    return accessory;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
