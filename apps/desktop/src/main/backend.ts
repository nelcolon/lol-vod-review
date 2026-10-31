import type {
  CauseTag,
  Clip,
  ClipBundle,
  PlayState,
  Game,
  GameBundle,
  Note,
  NoteInput,
  RecorderStatus,
  Settings,
} from '../shared/contracts';

export interface GameFiles {
  videos: string[];
  clips: Clip[];
  /** The game is being recorded right now (it must not be deleted). */
  recording: boolean;
}

/**
 * The seam between the Electron shell and the product core.
 *
 * Today `MockBackend` (./mock-backend.ts) implements this with an in-memory library that
 * points every segment at `dev-assets/sample.mp4`. When `@lvr/core` is ready, a
 * `CoreBackend` implements the same interface on top of core's SQLite store, lifecycle state
 * machine and recorder sidecar, and `createBackend()` in ./index.ts switches over. Nothing in
 * the IPC layer, preload or renderer needs to change.
 *
 * Contract notes:
 *  - All times handed to the renderer are *video* milliseconds inside a segment.
 *  - `getRecorderStatus` must be cheap; `onRecorderStatus` pushes changes.
 *  - `mediaRoots` lists the only directories the `lvr-media://` protocol may serve.
 */
export interface Backend {
  start(): Promise<void>;
  stop(): Promise<void>;

  listGames(): Promise<Game[]>;
  getGame(id: string): Promise<GameBundle | null>;

  saveNote(input: NoteInput): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  setTags(momentId: string, tags: CauseTag[]): Promise<void>;
  markReviewed(momentId: string): Promise<void>;

  /** Persist a clip row after the file has been written by the clip pipeline. */
  addClip(clip: Omit<Clip, 'id' | 'createdAt' | 'drawings' | 'description'>): Promise<Clip>;
  getClip(id: string): Promise<ClipBundle | null>;
  getPlayState(gameId: string, momentId: string): Promise<PlayState | null>;
  /** Persist edited fields (the caller has already re-cut the file when the range changed). */
  updateClip(id: string, patch: Partial<Pick<Clip, 'title' | 'description' | 'tInMs' | 'tOutMs' | 'path' | 'drawings'>>): Promise<Clip>;
  /** Returns the deleted clip (so the caller can remove its file). */
  deleteClip(id: string): Promise<Clip | null>;

  /** Video files and clips of a game, for the caller to reveal or delete; null if unknown. */
  gameFiles(id: string): Promise<GameFiles | null>;
  /** Removes the game's rows (notes, moments, clips...). The caller deletes the files first. */
  deleteGame(id: string): Promise<void>;

  getRecorderStatus(): RecorderStatus;
  onRecorderStatus(cb: (s: RecorderStatus) => void): () => void;

  /** Called on startup and whenever settings change (recording toggle, queues, ...). */
  applySettings(s: Settings): void;

  mediaRoots(): string[];
}
