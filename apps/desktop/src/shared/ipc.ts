import type {
  CauseTag,
  Clip,
  ClipBundle,
  PlayState,
  ClipExportResult,
  ClipPatch,
  Game,
  GameBundle,
  Note,
  NoteInput,
  RecorderStatus,
  Settings,
} from './contracts';

/** IPC channel names. Single source of truth for main + preload. */
export const IPC = {
  listGames: 'lvr:listGames',
  getGame: 'lvr:getGame',
  saveNote: 'lvr:saveNote',
  deleteNote: 'lvr:deleteNote',
  setTags: 'lvr:setTags',
  markReviewed: 'lvr:markReviewed',
  exportClip: 'lvr:exportClip',
  getClip: 'lvr:getClip',
  getPlayState: 'lvr:getPlayState',
  updateClip: 'lvr:updateClip',
  deleteClip: 'lvr:deleteClip',
  openClip: 'lvr:openClip',
  revealPath: 'lvr:revealPath',
  getSettings: 'lvr:getSettings',
  setSettings: 'lvr:setSettings',
  getRecorderStatus: 'lvr:getRecorderStatus',
  // main -> renderer pushes
  recorderStatus: 'lvr:ev:recorderStatus',
  settingsChanged: 'lvr:ev:settingsChanged',
  navigate: 'lvr:ev:navigate',
  clipsChanged: 'lvr:ev:clipsChanged',
} as const;

/** The API exposed on `window.lvr` by the preload script. */
export interface LvrApi {
  listGames(): Promise<Game[]>;
  getGame(id: string): Promise<GameBundle | null>;
  saveNote(input: NoteInput): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  setTags(momentId: string, tags: CauseTag[]): Promise<void>;
  markReviewed(momentId: string): Promise<void>;
  /** Cut a clip and open it in its own window. */
  exportClip(gameId: string, tInMs: number, tOutMs: number, title?: string): Promise<ClipExportResult>;
  getClip(id: string): Promise<ClipBundle | null>;
  getPlayState(gameId: string, momentId: string): Promise<PlayState | null>;
  /** Range changes re-cut the file. */
  updateClip(id: string, patch: ClipPatch): Promise<Clip>;
  deleteClip(id: string): Promise<void>;
  openClip(id: string): Promise<void>;
  /** A clip of this game was created, edited or deleted (any window). */
  onClipsChanged(cb: (gameId: string) => void): () => void;
  revealPath(path: string): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  getRecorderStatus(): Promise<RecorderStatus>;
  onRecorderStatus(cb: (s: RecorderStatus) => void): () => void;
  onSettingsChanged(cb: (s: Settings) => void): () => void;
  onNavigate(cb: (route: NavigateRoute) => void): () => void;
  /** Build a `lvr-media://` URL for a segment/clip path. */
  mediaUrl(path: string): string;
  platform: string;
}

export type NavigateRoute = { view: 'library' } | { view: 'game'; gameId: string } | { view: 'settings' };

export const MEDIA_SCHEME = 'lvr-media';

/** `lvr-media://local/<percent-encoded absolute path>` */
export function mediaUrl(absPath: string): string {
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(absPath)}`;
}

/** Inverse of `mediaUrl`. Returns null for anything that is not a `local` media URL. */
export function mediaPathFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${MEDIA_SCHEME}:` || u.hostname !== 'local') return null;
  const raw = u.pathname.replace(/^\/+/, '');
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
