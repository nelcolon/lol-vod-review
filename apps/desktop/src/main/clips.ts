/**
 * Clip export (PLAN §3.8): `ffmpeg -ss <in> -to <out> -i segment.mp4 -c copy`. With a 1 s GOP
 * the cut lands within 1 s of the requested in-point. Independent of the Backend: it only
 * needs the segment path and writes the file, then the caller persists the Clip row.
 */
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

export interface CutRequest {
  ffmpeg: string;
  input: string;
  outDir: string;
  tInMs: number;
  tOutMs: number;
  /** Used for the file name. */
  gameLabel: string;
}

export function clipFileName(gameLabel: string, tInMs: number, tOutMs: number, inputExt = '.mp4'): string {
  const safe = gameLabel.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}m${String(s % 60).padStart(2, '0')}s`;
  };
  return `${safe}_${fmt(tInMs)}-${fmt(tOutMs)}${inputExt || '.mp4'}`;
}

export function ffmpegCutArgs(input: string, output: string, tInMs: number, tOutMs: number): string[] {
  const sec = (ms: number) => (Math.max(0, ms) / 1000).toFixed(3);
  return ['-y', '-hide_banner', '-loglevel', 'error', '-ss', sec(tInMs), '-to', sec(tOutMs), '-i', input, '-c', 'copy', '-movflags', '+faststart', '-avoid_negative_ts', 'make_zero', output];
}

export function cutClip(req: CutRequest): Promise<string> {
  if (!(req.tOutMs > req.tInMs)) return Promise.reject(new Error('clip out-point must be after in-point'));
  mkdirSync(req.outDir, { recursive: true });
  const out = resolve(req.outDir, clipFileName(req.gameLabel, req.tInMs, req.tOutMs, extname(req.input)));
  const args = ffmpegCutArgs(req.input, out, req.tInMs, req.tOutMs);
  return new Promise((resolvePromise, reject) => {
    execFile(req.ffmpeg, args, { windowsHide: true, timeout: 120_000 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`ffmpeg failed (${basename(req.ffmpeg)}): ${stderr?.toString().trim() || err.message}`));
        return;
      }
      resolvePromise(out);
    });
  });
}
