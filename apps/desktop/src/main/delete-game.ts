import { rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { BrowserWindow } from 'electron';
import type { Backend } from './backend';

export function closeClipWindow(clipId: string): void {
  for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().endsWith(`#clip=${clipId}`)) w.close();
}

/**
 * Each game records into its own `<start time>_<game id>` folder right under a recordings folder;
 * only those get removed whole.
 */
function isGameFolder(dir: string, roots: string[]): boolean {
  const parent = resolve(dirname(dir)).toLowerCase();
  return /^\d{4}-\d{2}-\d{2}T/.test(basename(dir)) && roots.some((r) => resolve(r).toLowerCase() === parent);
}

// Retries ride out the media protocol still closing its read stream after the player let go.
const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 } as const;

/** Deletes a game's videos, its folder, its clips' files and then its rows. */
export async function deleteGame(backend: Backend, id: string): Promise<void> {
  const files = await backend.gameFiles(id);
  if (!files) throw new Error('game not found');
  if (files.recording) throw new Error('it is being recorded right now');
  for (const video of files.videos) {
    try {
      rmSync(video, RM);
    } catch {
      throw new Error(`the video is in use: ${video}`);
    }
  }
  const roots = backend.recordingRoots();
  for (const dir of new Set(files.videos.map((v) => dirname(v)))) if (isGameFolder(dir, roots)) rmSync(dir, RM);
  for (const clip of files.clips) {
    rmSync(clip.path, RM);
    closeClipWindow(clip.id);
  }
  await backend.deleteGame(id);
}
