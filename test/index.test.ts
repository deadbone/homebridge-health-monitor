import type { API } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';
import registerPlugin from '../src/index.js';
import { HealthMonitorPlatform } from '../src/platform.js';

describe('plugin entrypoint', () => {
  it('registers the Health Monitor platform', () => {
    const api = {
      registerPlatform: vi.fn(),
    } as unknown as API;

    registerPlugin(api);

    expect(api.registerPlatform).toHaveBeenCalledWith('homebridge-health-monitor', 'HealthMonitor', HealthMonitorPlatform);
  });
});
