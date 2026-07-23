import { open, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

const DEFAULT_BUFFER_SIZE = 64 * 1024;

export class LogTail {
  private file: FileHandle | undefined;
  private position = 0;
  private pending = '';

  public constructor(private readonly path: string) {}

  public async openAtEnd(): Promise<void> {
    await this.close();
    this.file = await open(this.path, 'r');
    const fileStat = await this.file.stat();
    this.position = fileStat.size;
    this.pending = '';
  }

  public async readNewLines(): Promise<string[]> {
    if (!this.file) {
      await this.openAtEnd();
      return [];
    }

    const fileStat = await stat(this.path);
    if (fileStat.size < this.position) {
      await this.openAtEnd();
      return [];
    }
    if (fileStat.size === this.position) {
      return [];
    }

    const length = fileStat.size - this.position;
    const chunks: string[] = [];
    let remaining = length;

    while (remaining > 0) {
      const readLength = Math.min(DEFAULT_BUFFER_SIZE, remaining);
      const buffer = Buffer.alloc(readLength);
      const result = await this.file.read(buffer, 0, readLength, this.position);
      if (result.bytesRead === 0) {
        break;
      }
      this.position += result.bytesRead;
      remaining -= result.bytesRead;
      chunks.push(buffer.subarray(0, result.bytesRead).toString('utf8'));
    }

    const text = this.pending + chunks.join('');
    const lines = text.split(/\r?\n/);
    this.pending = lines.pop() ?? '';
    return lines;
  }

  public async close(): Promise<void> {
    if (!this.file) {
      return;
    }
    await this.file.close();
    this.file = undefined;
  }
}
