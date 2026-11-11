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

  it('loads valid history entries and filters malformed records', async () => {
    const path = join(await makeTempDir(), 'history.json');
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        anomalies: [
          {
            timestamp: '2026-07-26T10:00:00.000Z',
            severity: 'warning',
            pluginName: undefined,
            message: 'valid warning',
          },
          {
            timestamp: '2026-07-26T10:00:01.000Z',
            severity: 'info',
            message: 'invalid severity',
          },
          {
            timestamp: '2026-07-26T10:00:02.000Z',
            severity: 'error',
            pluginName: 'homebridge-test',
            message: 'valid error',
          },
        ],
      }),
      'utf8',
    );

    const store = new HistoryStore(path, makeLog());

    await expect(store.load()).resolves.toMatchObject([
      {
        timestamp: '2026-07-26T10:00:00.000Z',
        severity: 'warning',
        message: 'valid warning',
      },
      {
        timestamp: '2026-07-26T10:00:02.000Z',
        severity: 'error',
        pluginName: 'homebridge-test',
        message: 'valid error',
      },
    ]);
  });
});

describe('history reliability', () => {
  it('serializes simultaneous additions and persists valid bounded JSON across restart', async () => {
    const path = join(await makeTempDir(), 'history.json');
    const store = new HistoryStore(path, makeLog(), 5);
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.add(makeAnomaly(`message ${String(index)}`, index * 1000))));
    const reopened = new HistoryStore(path, makeLog());
    const records = await reopened.load();
    expect(records).toHaveLength(5);
    expect(records[0]?.message).toBe('message 15');
    expect(records.at(-1)?.occurrences).toBe(1);
    expect(records.at(-1)?.firstOccurrence).toBe(new Date(19000).toISOString());
  });

  it('updates a repeated group without creating duplicate records', async () => {
    const path = join(await makeTempDir(), 'history.json');
    const store = new HistoryStore(path, makeLog());
    const groupKey = 'a'.repeat(64);
    await store.add({ ...makeAnomaly('same'), groupKey, occurrences: 1, firstOccurrence: 1000 });
    await store.add({ ...makeAnomaly('same', 2000), groupKey, occurrences: 2, firstOccurrence: 1000 });
    const records = await new HistoryStore(path, makeLog()).load();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ occurrences: 2, firstOccurrence: new Date(1000).toISOString(), lastOccurrence: new Date(2000).toISOString() });
  });

  it.each(['{broken', '{"schemaVersion":99,"anomalies":[]}', 'x'.repeat(8 * 1024 * 1024 + 1)])('recovers corrupt or oversized history', async (contents) => {
    const path = join(await makeTempDir(), 'history.json');
    await writeFile(path, contents);
    const log = makeLog();
    const store = new HistoryStore(path, log);
    expect(await store.load()).toEqual([]);
    expect(log.warn).toHaveBeenCalledOnce();
    await store.add(makeAnomaly('recovered'));
    expect(await new HistoryStore(path, log).load()).toHaveLength(1);
  });

  it('redacts old and new messages, discards invalid dates and migrates v1 records', async () => {
    const path = join(await makeTempDir(), 'history.json');
    await writeFile(path, JSON.stringify({ schemaVersion: 1, anomalies: [
      { timestamp: 'invalid', severity: 'error', message: 'bad' },
      { timestamp: new Date(1000).toISOString(), severity: 'error', message: 'password=secret' },
    ] }));
    const store = new HistoryStore(path, makeLog());
    expect(await store.load()).toMatchObject([{ pluginName: 'unknown', occurrences: 1, message: 'password=[redacted]' }]);
    await store.add(makeAnomaly('Authorization: Bearer xyz token=abc me@example.com'));
    const contents = await readFile(path, 'utf8');
    expect(contents).not.toContain('secret');
    expect(contents).not.toContain('xyz');
    expect(contents).not.toContain('abc');
    expect(contents).not.toContain('me@example.com');
  });
});
