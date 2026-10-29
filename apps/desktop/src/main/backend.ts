import type {
  CauseTag,
  Clip,
  Game,
  GameBundle,
  Note,
  NoteInput,
  RecorderStatus,
  Settings,
} from '../shared/contracts';

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
  addClip(clip: Omit<Clip, 'id' | 'createdAt'>): Promise<Clip>;

  getRecorderStatus(): RecorderStatus;
  onRecorderStatus(cb: (s: RecorderStatus) => void): () => void;

  /** Called on startup and whenever settings change (recording toggle, queues, ...). */
  applySettings(s: Settings): void;

  mediaRoots(): string[];
}
