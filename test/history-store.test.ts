import type { Logging } from 'homebridge';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryStore } from '../src/services/history-store.js';
import type { LogAnomaly } from '../src/services/log-analyzer.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'homebridge-health-monitor-'));
  tempDirs.push(dir);
  return dir;
}

function makeLog(): Logging {
  return {
    warn: vi.fn(),
  } as unknown as Logging;
}

function makeAnomaly(message: string, timestamp = 1_000): LogAnomaly {
  return {
    timestamp,
    severity: 'error',
    pluginName: 'homebridge-test',
    message,
    line: `[homebridge-test] [ERROR] ${message}`,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('HistoryStore', () => {
  it('returns an empty list when no history file exists', async () => {
    const store = new HistoryStore(join(await makeTempDir(), 'history.json'), makeLog());

    await expect(store.load()).resolves.toEqual([]);
  });

  it('saves bounded anomaly history with truncated messages', async () => {
    const path = join(await makeTempDir(), 'history.json');
    const store = new HistoryStore(path, makeLog(), 2);

    await store.add(makeAnomaly('first', 1_000));
    await store.add(makeAnomaly('second', 2_000));
    await store.add(makeAnomaly('x'.repeat(600), 3_000));

    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      anomalies: Array<{ message: string; timestamp: string }>;
    };

    expect(parsed.anomalies).toHaveLength(2);
    expect(parsed.anomalies[0]?.message).toBe('second');
    expect(parsed.anomalies[1]?.message).toHaveLength(500);
    expect(parsed.anomalies[1]?.timestamp).toBe(new Date(3_000).toISOString());
  });

  it('ignores invalid history files and logs a warning', async () => {
    const path = join(await makeTempDir(), 'history.json');
    const log = makeLog();
    await writeFile(path, '{not json', 'utf8');

    const store = new HistoryStore(path, log);

    await expect(store.load()).resolves.toEqual([]);
    expect(log.warn).toHaveBeenCalledOnce();
  });
});
