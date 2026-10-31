import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { BrowserWindow, ipcMain, shell } from 'electron';
import type { CauseTag, ClipExportResult, ClipPatch, DeleteGamesResult, Drawing, NoteInput, Settings } from '../shared/contracts';
import { IPC } from '../shared/ipc';
import type { Backend } from './backend';
import { cutClip } from './clips';
import { clipsDir, ffmpegPath, recordingsDir } from './paths';
import type { SettingsStore } from './settings';
import type { Updater } from './updater';

export interface IpcDeps {
  backend: Backend;
  settings: SettingsStore;
  getWindow: () => BrowserWindow | null;
  openClipWindow: (clipId: string) => void;
  updater: Updater;
}

function broadcastClipsChanged(gameId: string): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.clipsChanged, gameId);
}

function cleanDrawings(v: unknown): Drawing[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 500).flatMap((d): Drawing[] => {
    const x = d as Partial<Drawing>;
    if (typeof x.id !== 'string' || typeof x.tMs !== 'number' || !Array.isArray(x.shapes)) return [];
    const shapes = x.shapes.slice(0, 200).filter(
      (s) => (s.tool === 'arrow' || s.tool === 'circle' || s.tool === 'pen') && typeof s.color === 'string' && Array.isArray(s.points),
    );
    return [{ id: x.id, tMs: x.tMs, holdMs: typeof x.holdMs === 'number' ? x.holdMs : 3000, shapes }];
  });
}

function closeClipWindow(clipId: string): void {
  for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().endsWith(`#clip=${clipId}`)) w.close();
}

/** Each game records into its own folder right under the recordings folder; only those get removed whole. */
function isGameFolder(dir: string): boolean {
  return resolve(dirname(dir)).toLowerCase() === resolve(recordingsDir()).toLowerCase();
}

// Retries ride out the media protocol still closing its read stream after the player let go.
const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 } as const;

async function deleteGame(backend: Backend, id: string): Promise<void> {
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
  for (const dir of new Set(files.videos.map((v) => dirname(v)))) if (isGameFolder(dir)) rmSync(dir, RM);
  for (const clip of files.clips) {
    rmSync(clip.path, RM);
    closeClipWindow(clip.id);
  }
  await backend.deleteGame(id);
}

function assertString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`${name} must be a non-empty string`);
  return v;
}
function assertNumber(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a finite number`);
  return v;
}

export function registerIpc({ backend, settings, getWindow, openClipWindow, updater }: IpcDeps): void {
  ipcMain.handle(IPC.getUpdateStatus, () => updater.get());
  ipcMain.handle(IPC.checkForUpdate, () => updater.check());
  ipcMain.handle(IPC.downloadUpdate, () => updater.download());
  ipcMain.handle(IPC.installUpdate, () => updater.install());
  ipcMain.handle(IPC.listGames, () => backend.listGames());
  ipcMain.handle(IPC.getGame, (_e, id: unknown) => backend.getGame(assertString(id, 'id')));

  ipcMain.handle(IPC.saveNote, (_e, input: unknown) => {
    const i = input as Partial<NoteInput>;
    const clean: NoteInput = {
      gameId: assertString(i.gameId, 'gameId'),
      momentId: typeof i.momentId === 'string' ? i.momentId : null,
      videoTMs: assertNumber(i.videoTMs, 'videoTMs'),
      text: typeof i.text === 'string' ? i.text : '',
    };
    if (typeof i.id === 'string') clean.id = i.id;
    return backend.saveNote(clean);
  });
  ipcMain.handle(IPC.deleteNote, (_e, id: unknown) => backend.deleteNote(assertString(id, 'id')));
  ipcMain.handle(IPC.setTags, (_e, momentId: unknown, tags: unknown) =>
    backend.setTags(assertString(momentId, 'momentId'), Array.isArray(tags) ? (tags as CauseTag[]) : []),
  );
  ipcMain.handle(IPC.markReviewed, (_e, momentId: unknown) => backend.markReviewed(assertString(momentId, 'momentId')));

  ipcMain.handle(IPC.exportClip, async (_e, gameId: unknown, tInMs: unknown, tOutMs: unknown, title: unknown): Promise<ClipExportResult> => {
    try {
      const gid = assertString(gameId, 'gameId');
      const tIn = assertNumber(tInMs, 'tInMs');
      const tOut = assertNumber(tOutMs, 'tOutMs');
      const bundle = await backend.getGame(gid);
      if (!bundle) throw new Error(`unknown game ${gid}`);
      // v1: a clip lives inside one segment. Pick the segment that contains the in-point
      // (segments are concatenated in time only after reconnects; for now use the first).
      const segment = bundle.segments[0];
      if (!segment) throw new Error('game has no video segment');
      const label = `${bundle.game.startedAt.slice(0, 10)}_${bundle.game.myChampion}`;
      const path = await cutClip({ ffmpeg: ffmpegPath(), input: segment.path, outDir: clipsDir(), tInMs: tIn, tOutMs: tOut, gameLabel: label });
      const clip = await backend.addClip({
        gameId: gid,
        segmentId: segment.id,
        tInMs: tIn,
        tOutMs: tOut,
        path,
        pinned: false,
        title: typeof title === 'string' ? title.slice(0, 120) : '',
      });
      broadcastClipsChanged(gid);
      openClipWindow(clip.id);
      return { ok: true, clip, error: null };
    } catch (err) {
      return { ok: false, clip: null, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.getClip, (_e, id: unknown) => backend.getClip(assertString(id, 'id')));
  ipcMain.handle(IPC.getPlayState, (_e, gameId: unknown, momentId: unknown) =>
    backend.getPlayState(assertString(gameId, 'gameId'), assertString(momentId, 'momentId')),
  );
  ipcMain.handle(IPC.openClip, (_e, id: unknown) => openClipWindow(assertString(id, 'id')));

  ipcMain.handle(IPC.updateClip, async (_e, id: unknown, patch: unknown) => {
    const cid = assertString(id, 'id');
    const p = (patch ?? {}) as ClipPatch;
    const bundle = await backend.getClip(cid);
    if (!bundle) throw new Error(`unknown clip ${cid}`);
    const clean: Parameters<typeof backend.updateClip>[1] = {};
    if (typeof p.title === 'string') clean.title = p.title.slice(0, 120);
    if (typeof p.description === 'string') clean.description = p.description.slice(0, 4000);
    if (p.drawings !== undefined) clean.drawings = cleanDrawings(p.drawings);
    const tIn = p.tInMs !== undefined ? Math.max(0, assertNumber(p.tInMs, 'tInMs')) : bundle.clip.tInMs;
    const tOut = p.tOutMs !== undefined ? Math.min(assertNumber(p.tOutMs, 'tOutMs'), bundle.segment.durationMs || Infinity) : bundle.clip.tOutMs;
    const oldPath = bundle.clip.path;
    if (tIn !== bundle.clip.tInMs || tOut !== bundle.clip.tOutMs) {
      const label = `${bundle.game.startedAt.slice(0, 10)}_${bundle.game.myChampion}`;
      clean.path = await cutClip({ ffmpeg: ffmpegPath(), input: bundle.segment.path, outDir: clipsDir(), tInMs: tIn, tOutMs: tOut, gameLabel: label });
      clean.tInMs = tIn;
      clean.tOutMs = tOut;
    }
    const clip = await backend.updateClip(cid, clean);
    if (clean.path && clean.path !== oldPath) rmSync(oldPath, { force: true });
    broadcastClipsChanged(clip.gameId);
    return clip;
  });

  ipcMain.handle(IPC.deleteClip, async (_e, id: unknown) => {
    const clip = await backend.deleteClip(assertString(id, 'id'));
    if (!clip) return;
    rmSync(clip.path, { force: true });
    broadcastClipsChanged(clip.gameId);
    closeClipWindow(clip.id);
  });

  ipcMain.handle(IPC.deleteGames, async (_e, ids: unknown): Promise<DeleteGamesResult> => {
    const result: DeleteGamesResult = { deleted: [], failed: [] };
    for (const id of Array.isArray(ids) ? ids : []) {
      try {
        await deleteGame(backend, assertString(id, 'id'));
        result.deleted.push(id);
      } catch (err) {
        result.failed.push({ id: String(id), error: err instanceof Error ? err.message : String(err) });
      }
    }
    return result;
  });

  ipcMain.handle(IPC.revealGame, async (_e, id: unknown) => {
    const video = (await backend.gameFiles(assertString(id, 'id')))?.videos.find((v) => existsSync(v));
    if (video) shell.showItemInFolder(video);
    else await shell.openPath(recordingsDir());
  });

  ipcMain.handle(IPC.revealPath, (_e, path: unknown) => {
    shell.showItemInFolder(assertString(path, 'path'));
  });

  ipcMain.handle(IPC.getSettings, () => settings.get());
  ipcMain.handle(IPC.setSettings, (_e, patch: unknown) => settings.patch((patch ?? {}) as Partial<Settings>));
  ipcMain.handle(IPC.getRecorderStatus, () => backend.getRecorderStatus());

  // pushes
  backend.onRecorderStatus((s) => getWindow()?.webContents.send(IPC.recorderStatus, s));
  settings.onChange((s) => getWindow()?.webContents.send(IPC.settingsChanged, s));
}
