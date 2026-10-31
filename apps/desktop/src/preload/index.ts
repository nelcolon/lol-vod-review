import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CauseTag, ClipPatch, NoteInput, RecorderStatus, Settings, UpdateStatus } from '../shared/contracts';
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
  exportClip: (gameId: string, tInMs: number, tOutMs: number, title?: string) => ipcRenderer.invoke(IPC.exportClip, gameId, tInMs, tOutMs, title),
  getClip: (id: string) => ipcRenderer.invoke(IPC.getClip, id),
  getPlayState: (gameId: string, momentId: string) => ipcRenderer.invoke(IPC.getPlayState, gameId, momentId),
  updateClip: (id: string, patch: ClipPatch) => ipcRenderer.invoke(IPC.updateClip, id, patch),
  deleteClip: (id: string) => ipcRenderer.invoke(IPC.deleteClip, id),
  openClip: (id: string) => ipcRenderer.invoke(IPC.openClip, id),
  onClipsChanged: (cb) => subscribe<string>(IPC.clipsChanged, cb),
  revealPath: (path: string) => ipcRenderer.invoke(IPC.revealPath, path),
  revealGame: (id: string) => ipcRenderer.invoke(IPC.revealGame, id),
  deleteGames: (ids: string[]) => ipcRenderer.invoke(IPC.deleteGames, ids),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke(IPC.setSettings, patch),
  getRecorderStatus: () => ipcRenderer.invoke(IPC.getRecorderStatus),
  onRecorderStatus: (cb) => subscribe<RecorderStatus>(IPC.recorderStatus, cb),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.getUpdateStatus),
  checkForUpdate: () => ipcRenderer.invoke(IPC.checkForUpdate),
  downloadUpdate: () => ipcRenderer.invoke(IPC.downloadUpdate),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  onUpdateStatus: (cb) => subscribe<UpdateStatus>(IPC.updateStatus, cb),
  onSettingsChanged: (cb) => subscribe<Settings>(IPC.settingsChanged, cb),
  onNavigate: (cb) => subscribe<NavigateRoute>(IPC.navigate, cb),
  mediaUrl,
  platform: process.platform,
};

contextBridge.exposeInMainWorld('lvr', api);
