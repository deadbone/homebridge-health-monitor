import { appendFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LogTail } from '../src/services/log-tail.js';

const dirs: string[] = [];
const tails: LogTail[] = [];
async function setup(contents = ''): Promise<{ path: string; tail: LogTail }> {
  const dir = await mkdtemp(join(tmpdir(), 'health-tail-'));
  dirs.push(dir);
  const path = join(dir, 'log');
  await writeFile(path, contents);
  const tail = new LogTail(path);
  tails.push(tail);
  return { path, tail };
}
afterEach(async () => {
  await Promise.all(tails.splice(0).map((tail) => tail.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('LogTail real files', () => {
  it('starts at EOF, buffers incomplete lines and handles CRLF', async () => {
    const { path, tail } = await setup('old\n');
    await tail.openAtEnd();
    await appendFile(path, 'new\r\npartial');
    expect(await tail.readNewLines()).toEqual(['new']);
    await appendFile(path, ' done\n');
    expect(await tail.readNewLines()).toEqual(['partial done']);
    expect(await tail.readNewLines()).toEqual([]);
  });

  it('does not analyze the continuation of a preexisting partial line', async () => {
    const { path, tail } = await setup('old partial');
    await tail.openAtEnd();
    await appendFile(path, ' suffix\nnew\n');
    expect(await tail.readNewLines()).toEqual(['new']);
  });

  it('reads from the beginning following truncation', async () => {
    const { path, tail } = await setup('long old content\n');
    await tail.openAtEnd();
    await writeFile(path, 'new\n');
    expect(await tail.readNewLines()).toEqual(['new']);
  });

  it.each(['new\n', 'same length\n', 'replacement with greater length\n'])('handles inode replacement: %s', async (replacement) => {
    const { path, tail } = await setup('same length\n');
    await tail.openAtEnd();
    await appendFile(path, 'old final\n');
    await rename(path, `${path}.old`);
    await writeFile(path, replacement);
    const lines = [...await tail.readNewLines(), ...await tail.readNewLines()];
    expect(lines).toEqual(['old final', replacement.trimEnd()]);
    expect(await tail.readNewLines()).toEqual([]);
  });

  it('recovers after disappearance and reappearance without duplicating old lines', async () => {
    const { path, tail } = await setup();
    await tail.openAtEnd();
    await rename(path, `${path}.old`);
    await expect(tail.readNewLines()).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(path, 'recovered\n');
    expect([...await tail.readNewLines(), ...await tail.readNewLines()]).toEqual(['recovered']);
  });

  it('recovers from an initial inaccessible source and reads newly created lines', async () => {
    const { path, tail } = await setup();
    await rm(path);
    await expect(tail.openAtEnd()).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(path, 'appeared\n');
    expect(await tail.readNewLines()).toEqual(['appeared']);
  });

  it('decodes UTF-8 split between polls and 64 KiB blocks', async () => {
    const { path, tail } = await setup();
    await tail.openAtEnd();
    const bytes = Buffer.from('été🙂\n');
    for (let i = 0; i < bytes.length; i++) {
      await appendFile(path, bytes.subarray(i, i + 1));
      expect(await tail.readNewLines()).toEqual(i === bytes.length - 1 ? ['été🙂'] : []);
    }
    const prefix = `${'a\n'.repeat(32767)}b`;
    await appendFile(path, `${prefix}🙂\n`);
    const lines = await tail.readNewLines();
    expect(lines).toHaveLength(32768);
    expect(lines.at(-1)).toBe('b🙂');
  });

  it('serializes concurrent reads and closes after a pending read', async () => {
    const { path, tail } = await setup();
    await tail.openAtEnd();
    await appendFile(path, 'once\ntwice\n');
    const results = await Promise.all([tail.readNewLines(), tail.readNewLines(), tail.readNewLines()]);
    expect(results.flat()).toEqual(['once', 'twice']);
    await appendFile(path, 'last\n');
    const read = tail.readNewLines();
    const close = tail.close();
    expect(await read).toEqual(['last']);
    await close;
  });

  it('bounds unfinished lines and resumes on the next complete line', async () => {
    const { path, tail } = await setup();
    await tail.openAtEnd();
    await appendFile(path, `${'x'.repeat(70000)}\nvalid\n`);
    expect(await tail.readNewLines()).toEqual(['valid']);
  });

  it('opens lazily at EOF', async () => {
    const { path, tail } = await setup('old\n');
    expect(await tail.readNewLines()).toEqual([]);
    await appendFile(path, 'new\n');
    expect(await tail.readNewLines()).toEqual(['new']);
  });
});

describe('additional reader recovery', () => {
  it('rejects a directory without retaining its handle and recovers after correction', async () => {
    const { path, tail } = await setup();
    await rm(path);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path);
    await expect(tail.openAtEnd()).rejects.toThrow('regular file');
    await rm(path, { recursive: true });
    await writeFile(path, 'recovered\n');
    expect(await tail.readNewLines()).toEqual(['recovered']);
  });

  it('discards a partial UTF-8 sequence from the old file during rotation', async () => {
    const { path, tail } = await setup();
    await tail.openAtEnd();
    await appendFile(path, Buffer.from([0xf0, 0x9f]));
    expect(await tail.readNewLines()).toEqual([]);
    await rename(path, `${path}.old`);
    await writeFile(path, 'é🙂\n');
    expect([...await tail.readNewLines(), ...await tail.readNewLines()]).toEqual(['é🙂']);
  });
});
