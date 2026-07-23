import type { Logging } from 'homebridge';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedPlatformConfig } from '../src/config/types.js';
import { HealthMonitor } from '../src/services/health-monitor.js';
import { HistoryStore } from '../src/services/history-store.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'homebridge-health-monitor-'));
  tempDirs.push(dir);
  return dir;
}

function makeLog(): Logging {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logging;
}

function makeConfig(logFile: string): NormalizedPlatformConfig {
  return {
    name: 'Homebridge Health Monitor',
    logFile,
    scanIntervalSeconds: 10,
    analysisWindowSeconds: 60,
    resetAfterSeconds: 1,
    errorThreshold: 1,
    monitorWarnings: false,
    debug: true,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('HealthMonitor', () => {
  it('logs and emits an inactive state when the log file cannot be opened', async () => {
    const dir = await makeTempDir();
    const logFile = join(dir, 'missing.log');
    const log = makeLog();
    const monitor = new HealthMonitor(makeConfig(logFile), log, new HistoryStore(join(dir, 'history.json'), log));
    const statuses: boolean[] = [];
    monitor.onStatus((status) => statuses.push(status.active));

    monitor.start();

    await vi.waitFor(() => {
      expect(log.warn).toHaveBeenCalledWith(
        'Health Monitor cannot read %s: %s. Monitoring is disabled.',
        logFile,
        expect.stringContaining('ENOENT'),
      );
    });
    expect(statuses).toEqual([false]);
  });

  it('detects appended anomalies and resets after the quiet period', async () => {
    vi.useFakeTimers();
    const dir = await makeTempDir();
    const logFile = join(dir, 'homebridge.log');
    await writeFile(logFile, '', 'utf8');
    const log = makeLog();
    const monitor = new HealthMonitor(makeConfig(logFile), log, new HistoryStore(join(dir, 'history.json'), log));
    const statuses: boolean[] = [];
    monitor.onStatus((status) => statuses.push(status.active));

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => {
      expect(log.info).toHaveBeenCalledWith('Health Monitor started watching %s', logFile);
    });

    await writeFile(logFile, '[homebridge-test] [ERROR] failed\n', 'utf8');
    await vi.advanceTimersByTimeAsync(10_000);

    await vi.waitFor(() => {
      expect(statuses).toContain(true);
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => {
      expect(statuses.at(-1)).toBe(false);
    });

    monitor.stop();
  });
});
