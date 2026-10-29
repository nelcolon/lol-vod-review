/**
 * HTTP Range header parsing for the `lvr-media://` protocol (single range only; the
 * `<video>` element never asks for multipart ranges).
 */

export type RangeResult =
  | { kind: 'full' } // no / malformed header -> 200 with the whole file
  | { kind: 'partial'; start: number; end: number } // inclusive bounds -> 206
  | { kind: 'unsatisfiable' }; // -> 416

export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return { kind: 'full' };
  const m = /^\s*bytes\s*=\s*(.+)$/i.exec(header);
  if (!m || !m[1]) return { kind: 'full' };
  // Only the first range of a comma-separated list is honoured.
  const first = m[1].split(',')[0]?.trim() ?? '';
  const parts = /^(\d*)\s*-\s*(\d*)$/.exec(first);
  if (!parts) return { kind: 'full' };
  const [, startStr = '', endStr = ''] = parts;
  if (startStr === '' && endStr === '') return { kind: 'full' };
  if (size <= 0) return { kind: 'unsatisfiable' };

  if (startStr === '') {
    // suffix range: last N bytes
    const n = Number(endStr);
    if (!Number.isFinite(n) || n <= 0) return { kind: 'unsatisfiable' };
    const start = Math.max(0, size - n);
    return { kind: 'partial', start, end: size - 1 };
  }
  const start = Number(startStr);
  if (!Number.isFinite(start) || start >= size) return { kind: 'unsatisfiable' };
  let end = endStr === '' ? size - 1 : Number(endStr);
  if (!Number.isFinite(end) || end < start) return { kind: 'unsatisfiable' };
  if (end >= size) end = size - 1;
  return { kind: 'partial', start, end };
}

export function contentRange(start: number, end: number, size: number): string {
  return `bytes ${start}-${end}/${size}`;
}
