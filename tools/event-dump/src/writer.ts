import { createWriteStream, type WriteStream } from 'node:fs';

/** Append-only JSONL file. BigInts are written as decimal strings. */
export class JsonlWriter {
  private readonly stream: WriteStream;
  lines = 0;

  constructor(readonly path: string) {
    this.stream = createWriteStream(path, { flags: 'a', encoding: 'utf8' });
  }

  write(record: unknown): void {
    this.stream.write(`${JSON.stringify(record, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))}\n`);
    this.lines++;
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  }
}

/** `YYYYMMDD-HHMMSS` in local time. */
export function sessionFolderName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
