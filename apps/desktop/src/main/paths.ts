import { app } from 'electron';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Repo root in dev (apps/desktop -> ../..). Only meaningful when not packaged. */
export function repoRoot(): string {
  return resolve(app.getAppPath(), '..', '..');
}

/** FFmpeg: bundled next to the exe when packaged, `tools/bin/ffmpeg.exe` in dev. */
export function ffmpegPath(): string {
  if (app.isPackaged) return resolve(process.resourcesPath, 'ffmpeg.exe');
  const dev = resolve(repoRoot(), 'tools', 'bin', 'ffmpeg.exe');
  return existsSync(dev) ? dev : 'ffmpeg';
}

export function devAssetsDir(): string {
  return resolve(app.getAppPath(), 'dev-assets');
}

export function sampleVideoPath(): string {
  return resolve(devAssetsDir(), 'sample.mp4');
}

export function clipsDir(): string {
  return resolve(app.getPath('userData'), 'clips');
}

export function recordingsDir(): string {
  return resolve(app.getPath('userData'), 'recordings');
}

export function settingsPath(): string {
  return resolve(app.getPath('userData'), 'settings.json');
}

export function mockStatePath(): string {
  return resolve(app.getPath('userData'), 'mock-state.json');
}

/** Recorder sidecar: bundled next to the exe when packaged, the cargo release build in dev. */
export function recorderPath(): string {
  if (app.isPackaged) return resolve(process.resourcesPath, 'lvr-recorder.exe');
  return resolve(repoRoot(), 'packages', 'recorder', 'target', 'release', 'lvr-recorder.exe');
}

export function dbPath(): string {
  return resolve(app.getPath('userData'), 'lvr.sqlite');
}
