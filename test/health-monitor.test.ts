import type { Logging } from 'homebridge';
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeConfig } from '../src/config/validation.js';
import { HealthMonitor, type HealthStatus } from '../src/services/health-monitor.js';
import { HistoryStore } from '../src/services/history-store.js';

const dirs: string[] = [];
const monitors: HealthMonitor[] = [];
async function setup(options: { missing?: boolean; separate?: boolean; badHistory?: boolean; threshold?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'health-monitor-'));
  dirs.push(dir);
  const path = join(dir, 'log');
  const historyPath = join(dir, 'history.json');
  if (!options.missing) {
    await writeFile(path, 'old\n');
  }
  if (options.badHistory) {
    await mkdir(historyPath);
  }
  const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as Logging;
  const config = {
    ...normalizeConfig({ platform: 'HealthMonitor' }, dir),
    logFile: path, scanIntervalSeconds: 0.01, reconnectIntervalSeconds: 0.02,
    resetAfterSeconds: 0.15, errorThreshold: options.threshold ?? 1,
    separateWarningSensor: options.separate ?? false, warningThreshold: 2,
  };
  const history = new HistoryStore(historyPath, log);
  const monitor = new HealthMonitor(config, log, history);
  monitors.push(monitor);
  const statuses: HealthStatus[] = [];
  monitor.onStatus((status) => statuses.push(status));
  return { dir, path, historyPath, monitor, history, statuses, log, config };
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(async () => {
  await Promise.all(monitors.splice(0).map((monitor) => monitor.stop()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('HealthMonitor integration', () => {
  it('retries a missing file, rate limits warnings and reads lines when it appears', async () => {
    const { monitor, path, statuses, log } = await setup({ missing: true });
    monitor.start();
    await vi.waitFor(() => { expect(statuses.at(-1)?.monitoring).toBe('UNAVAILABLE'); });
    await wait(100);
    expect(log.warn).toHaveBeenCalledTimes(1);
    await writeFile(path, '[homebridge-test] [ERROR] appeared\n');
    await vi.waitFor(() => { expect(statuses.at(-1)).toMatchObject({ monitoring: 'OPERATIONAL', active: true }); });
    expect(statuses.some((status) => status.monitoring === 'RECONNECTING')).toBe(true);
  });

  it('detects errors, resets once, and does not reactivate using pre-reset evidence', async () => {
    const { monitor, path, statuses } = await setup({ threshold: 2 });
    monitor.start();
    await vi.waitFor(() => { expect(statuses.at(-1)?.monitoring).toBe('OPERATIONAL'); });
    await appendFile(path, '[homebridge-test] [ERROR] first\n[homebridge-test] [ERROR] second\n');
    await vi.waitFor(() => { expect(statuses.at(-1)?.active).toBe(true); });
    await vi.waitFor(() => { expect(statuses.at(-1)?.active).toBe(false); });
    await appendFile(path, '[homebridge-test] [ERROR] third\n');
    await wait(60);
    expect(statuses.at(-1)?.active).toBe(false);
  });

  it('keeps the existing alert during an outage and reports unknown diagnostics', async () => {
    const { monitor, path, statuses } = await setup();
    monitor.start();
    await vi.waitFor(() => { expect(statuses.at(-1)?.monitoring).toBe('OPERATIONAL'); });
    await appendFile(path, '[homebridge-test] [ERROR] failed\n');
    await vi.waitFor(() => { expect(statuses.at(-1)?.active).toBe(true); });
    await rename(path, `${path}.old`);
    await wait(220);
    expect(statuses.at(-1)).toMatchObject({ active: true, monitoring: 'UNAVAILABLE' });
    expect(statuses.at(-1)?.snapshot.plugins[0]?.severity).toBe('UNKNOWN');
    await rename(`${path}.old`, path);
    await vi.waitFor(() => { expect(statuses.at(-1)).toMatchObject({ active: false, monitoring: 'OPERATIONAL' }); });
  });

  it('keeps monitoring and retries history writes after a storage failure', async () => {
    const { monitor, path, historyPath, statuses, log } = await setup({ badHistory: true });
    monitor.start();
    await vi.waitFor(() => { expect(statuses.at(-1)?.monitoring).toBe('OPERATIONAL'); });
    await appendFile(path, '[homebridge-test] [ERROR] first\n[homebridge-test] [ERROR] second\n');
    await vi.waitFor(() => { expect(statuses.at(-1)?.active).toBe(true); });
    expect(statuses.at(-1)?.snapshot.anomalyCount).toBe(2);
    await vi.waitFor(() => { expect(log.warn).toHaveBeenCalledWith('Health Monitor cannot save anomaly history; log monitoring continues.'); });
    await rm(historyPath, { recursive: true });
    await appendFile(path, '[homebridge-test] [ERROR] third\n');
    await vi.waitFor(() => { expect(log.info).toHaveBeenCalledWith('Health Monitor history storage restored.'); });
    expect(await readFile(historyPath, 'utf8')).toContain('third');
  });

  it('separates warning thresholds from error thresholds', async () => {
    const { monitor, path, statuses } = await setup({ separate: true });
    monitor.start();
    await vi.waitFor(() => { expect(statuses.at(-1)?.monitoring).toBe('OPERATIONAL'); });
    await appendFile(path, '[homebridge-test] [WARN] first\n');
    await wait(30);
    expect(statuses.at(-1)).toMatchObject({ active: false, warningActive: false });
    await appendFile(path, '[homebridge-test] [WARNING] second\n');
    await vi.waitFor(() => { expect(statuses.at(-1)).toMatchObject({ active: false, warningActive: true }); });
    await appendFile(path, '[homebridge-test] [ERROR] failed\n');
    await vi.waitFor(() => { expect(statuses.at(-1)).toMatchObject({ active: true, warningActive: true }); });
    await vi.waitFor(() => { expect(statuses.at(-1)).toMatchObject({ active: false, warningActive: false }); });
  });

  it('waits for a pending write on shutdown and never starts a concurrent poll', async () => {
    const { monitor, history, path, statuses } = await setup();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = history.addMany.bind(history);
    const add = vi.spyOn(history, 'addMany').mockImplementation(async (item) => { await gate; await original(item); });
    monitor.start();
    await vi.waitFor(() => { expect(statuses.at(-1)?.monitoring).toBe('OPERATIONAL'); });
    await appendFile(path, '[homebridge-test] [ERROR] first\n');
    await vi.waitFor(() => { expect(add).toHaveBeenCalledTimes(1); });
    await appendFile(path, '[homebridge-test] [ERROR] later\n');
    await wait(60);
    expect(add).toHaveBeenCalledTimes(1);
    const stopped = monitor.stop();
    release?.();
    await stopped;
    expect(statuses.at(-1)?.monitoring).toBe('DISABLED');
    await wait(40);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('cancels startup during history loading and can restart cleanly at EOF', async () => {
    const { monitor, history, path, statuses, log } = await setup();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = history.load.bind(history);
    const load = vi.spyOn(history, 'load').mockImplementationOnce(async () => { await gate; return original(); });
    monitor.start();
    await vi.waitFor(() => { expect(load).toHaveBeenCalledOnce(); });
    const stopped = monitor.stop();
    release?.();
    await stopped;
    expect(log.info).not.toHaveBeenCalled();
    await appendFile(path, '[homebridge-test] [ERROR] old\n');
    monitor.start();
    await vi.waitFor(() => { expect(statuses.at(-1)?.monitoring).toBe('OPERATIONAL'); });
    expect(statuses.at(-1)?.active).toBe(false);
    expect(statuses.at(-1)?.snapshot.anomalyCount).toBe(0);
    await appendFile(path, '[homebridge-test] [ERROR] new\n');
    await vi.waitFor(() => { expect(statuses.at(-1)?.active).toBe(true); });
  });
});
