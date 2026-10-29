import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CauseTag, NoteInput, RecorderStatus, Settings } from '../shared/contracts';
import { IPC, mediaUrl, type LvrApi, type NavigateRoute } from '../shared/ipc';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: LvrApi = {
  listGames: () => ipcRenderer.invoke(IPC.listGames),
  getGame: (id: string) => ipcRenderer.invoke(IPC.getGame, id),
  saveNote: (input: NoteInput) => ipcRenderer.invoke(IPC.saveNote, input),
  deleteNote: (id: string) => ipcRenderer.invoke(IPC.deleteNote, id),
  setTags: (momentId: string, tags: CauseTag[]) => ipcRenderer.invoke(IPC.setTags, momentId, tags),
  markReviewed: (momentId: string) => ipcRenderer.invoke(IPC.markReviewed, momentId),
  exportClip: (gameId: string, tInMs: number, tOutMs: number) => ipcRenderer.invoke(IPC.exportClip, gameId, tInMs, tOutMs),
  revealPath: (path: string) => ipcRenderer.invoke(IPC.revealPath, path),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke(IPC.setSettings, patch),
  getRecorderStatus: () => ipcRenderer.invoke(IPC.getRecorderStatus),
  onRecorderStatus: (cb) => subscribe<RecorderStatus>(IPC.recorderStatus, cb),
  onSettingsChanged: (cb) => subscribe<Settings>(IPC.settingsChanged, cb),
  onNavigate: (cb) => subscribe<NavigateRoute>(IPC.navigate, cb),
  mediaUrl,
  platform: process.platform,
};

contextBridge.exposeInMainWorld('lvr', api);
