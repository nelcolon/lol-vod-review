import { ipcMain, shell, type BrowserWindow } from 'electron';
import type { CauseTag, ClipExportResult, NoteInput, Settings } from '../shared/contracts';
import { IPC } from '../shared/ipc';
import type { Backend } from './backend';
import { cutClip } from './clips';
import { clipsDir, ffmpegPath } from './paths';
import type { SettingsStore } from './settings';

export interface IpcDeps {
  backend: Backend;
  settings: SettingsStore;
  getWindow: () => BrowserWindow | null;
}

function assertString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`${name} must be a non-empty string`);
  return v;
}
function assertNumber(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a finite number`);
  return v;
}

export function registerIpc({ backend, settings, getWindow }: IpcDeps): void {
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

  ipcMain.handle(IPC.exportClip, async (_e, gameId: unknown, tInMs: unknown, tOutMs: unknown): Promise<ClipExportResult> => {
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
      const clip = await backend.addClip({ gameId: gid, segmentId: segment.id, tInMs: tIn, tOutMs: tOut, path, pinned: false });
      return { ok: true, clip, error: null };
    } catch (err) {
      return { ok: false, clip: null, error: err instanceof Error ? err.message : String(err) };
    }
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
