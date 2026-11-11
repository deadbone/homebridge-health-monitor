import { open, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

const BUFFER_SIZE = 64 * 1024;
const CYCLE_BYTES = 1024 * 1024;

export class LogTail {
  private file: FileHandle | undefined;
  private position = 0;
  private pending = '';
  private decoder = new StringDecoder('utf8');
  private discarding = false;
  private attempted = false;
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(private readonly path: string) {}

  public openAtEnd(): Promise<void> {
    return this.serialize(async () => {
      await this.release();
      this.attempted = true;
      await this.openFile(true);
    });
  }

  public readNewLines(): Promise<string[]> {
    return this.serialize(() => this.read());
  }

  public close(): Promise<void> {
    return this.serialize(() => this.release());
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async openFile(atEnd: boolean): Promise<void> {
    const file = await open(this.path, 'r');
    try {
      const info = await file.stat();
      if (!info.isFile()) {
        throw new Error('Log source is not a regular file');
      }
      this.reset();
      this.position = atEnd ? info.size : 0;
      if (atEnd && info.size > 0) {
        const last = Buffer.alloc(1);
        await file.read(last, 0, 1, info.size - 1);
        this.discarding = last[0] !== 10;
      }
      this.file = file;
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  private async read(): Promise<string[]> {
    if (!this.file) {
      const atEnd = !this.attempted;
      this.attempted = true;
      await this.openFile(atEnd);
    }
    const file = this.file;
    if (!file) {
      return [];
    }
    const pathInfo = await stat(this.path);
    const current = await file.stat();
    if (pathInfo.dev !== current.dev || pathInfo.ino !== current.ino) {
      // Drain the old descriptor before switching, including appends made before rename.
      const lines = await this.readTo(current.size);
      if (this.position < current.size) {
        return lines;
      }
      await this.release();
      // Return old lines even if the new path disappears during this cycle.
      // Opening the replacement is retried on the next poll.
      return lines;
    }
    if (current.size < this.position) {
      this.reset();
    }
    return this.readTo(current.size);
  }

  private async readTo(size: number): Promise<string[]> {
    const lines: string[] = [];
    let remaining = Math.min(size - this.position, CYCLE_BYTES);
    while (remaining > 0 && this.file) {
      const buffer = Buffer.alloc(Math.min(BUFFER_SIZE, remaining));
      const { bytesRead } = await this.file.read(buffer, 0, buffer.length, this.position);
      if (bytesRead === 0) {
        break;
      }
      this.position += bytesRead;
      remaining -= bytesRead;
      const text = this.decoder.write(buffer.subarray(0, bytesRead));
      const parts = text.split('\n');
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index] ?? '';
        if (!this.discarding) {
          this.pending += part;
          if (this.pending.length > BUFFER_SIZE) {
            this.pending = '';
            this.discarding = true;
          }
        }
        if (index < parts.length - 1) {
          if (!this.discarding) {
            lines.push(this.pending.replace(/\r$/, ''));
          }
          this.pending = '';
          this.discarding = false;
        }
      }
    }
    return lines;
  }

  private reset(): void {
    this.position = 0;
    this.pending = '';
    this.discarding = false;
    this.decoder = new StringDecoder('utf8');
  }

  private async release(): Promise<void> {
    const file = this.file;
    this.file = undefined;
    this.reset();
    await file?.close();
  }
}
