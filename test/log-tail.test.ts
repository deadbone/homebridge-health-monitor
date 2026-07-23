import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LogTail } from '../src/services/log-tail.js';

const tempDirs: string[] = [];

async function makeLogFile(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'homebridge-health-monitor-'));
  tempDirs.push(dir);
  const path = join(dir, 'homebridge.log');
  await writeFile(path, contents, 'utf8');
  return path;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('LogTail', () => {
  it('opens at the end and reads only appended complete lines', async () => {
    const path = await makeLogFile('old line\n');
    const tail = new LogTail(path);

    await tail.openAtEnd();
    expect(await tail.readNewLines()).toEqual([]);

    await writeFile(path, 'old line\nnew line\npartial', 'utf8');
    expect(await tail.readNewLines()).toEqual(['new line']);

    await writeFile(path, 'old line\nnew line\npartial done\n', 'utf8');
    expect(await tail.readNewLines()).toEqual(['partial done']);

    await tail.close();
  });

  it('reopens at the end when the log file is truncated', async () => {
    const path = await makeLogFile('first\nsecond\n');
    const tail = new LogTail(path);

    await tail.openAtEnd();
    await writeFile(path, 'rotated\n', 'utf8');

    expect(await tail.readNewLines()).toEqual([]);

    await tail.close();
  });
});
