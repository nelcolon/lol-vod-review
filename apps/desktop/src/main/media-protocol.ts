/**
 * `lvr-media://local/<encoded absolute path>` — serves local recordings/clips to the renderer
 * with HTTP Range support so `<video>` can seek. Only files under `allowedRoots` are served.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { MEDIA_SCHEME, mediaPathFromUrl } from '../shared/ipc';
import { contentRange, parseRange } from '../shared/range';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.vtt': 'text/vtt',
};

/** Must run before `app.whenReady()` resolves. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false, corsEnabled: true },
    },
  ]);
}

export function isUnderRoot(file: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(file));
  if (rel === '') return false;
  const relNorm = process.platform === 'win32' ? rel.toLowerCase() : rel;
  return !relNorm.startsWith('..') && !isAbsolute(relNorm) && !relNorm.startsWith(`..${sep}`);
}

/** Call after the app is ready. `allowedRoots` is re-evaluated per request so it can change. */
export function installMediaProtocol(allowedRoots: () => string[]): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const file = mediaPathFromUrl(request.url);
    if (!file || !isAbsolute(file)) return new Response('bad media url', { status: 400 });
    if (!allowedRoots().some((root) => isUnderRoot(file, root))) {
      console.warn('[media] refused path outside media roots:', file);
      return new Response('forbidden', { status: 403 });
    }
    let size: number;
    try {
      const st = await stat(file);
      if (!st.isFile()) return new Response('not a file', { status: 404 });
      size = st.size;
    } catch {
      return new Response('not found', { status: 404 });
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const base: Record<string, string> = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    const range = parseRange(request.headers.get('range'), size);
    if (range.kind === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    }
    const start = range.kind === 'partial' ? range.start : 0;
    const end = range.kind === 'partial' ? range.end : size - 1;
    const headers: Record<string, string> = { ...base, 'Content-Length': String(end - start + 1) };
    if (range.kind === 'partial') headers['Content-Range'] = contentRange(start, end, size);
    const status = range.kind === 'partial' ? 206 : 200;
    if (request.method === 'HEAD') return new Response(null, { status, headers });
    if (size === 0) return new Response(new Uint8Array(0), { status, headers });
    const nodeStream = createReadStream(file, { start, end });
    const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, { status, headers });
  });
}
