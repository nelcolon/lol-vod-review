import { readFile } from 'node:fs/promises';
import { DEFAULT_LOCKFILE_PATH, LCU_ENDPOINTS, lcuAuthHeader, lcuBaseUrl, parseLockfile, type Lockfile } from '@lvr/schema';
import { lcuGet } from './http';

export interface LcuSessionInfo {
  gameId: string | null;
  queueId: number | null;
  gameMode: string | null;
  mapId: number | null;
}

export interface LcuWatcherEvents {
  onLockfile(present: boolean): void;
  onPhase(phase: string): void;
  /** Fetched once per change into an in-game phase. */
  onSession(info: LcuSessionInfo): void;
}

const IN_GAME = new Set(['GameStart', 'InProgress', 'Reconnect']);

/**
 * Polls the lockfile (every 2 s) and, while the client is up, `gameflow-phase` at 1 Hz.
 * Read-only LCU GETs only.
 */
export class LcuWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lockfile: Lockfile | null = null;
  private present: boolean | null = null;
  private phase: string | null = null;
  private busy = false;
  private ticks = 0;

  constructor(
    private readonly ev: LcuWatcherEvents,
    private readonly lockfilePath = DEFAULT_LOCKFILE_PATH,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 1000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.lockfile || this.ticks++ % 2 === 0) await this.readLockfile();
      if (this.lockfile) await this.pollPhase(this.lockfile);
    } finally {
      this.busy = false;
    }
  }

  private async readLockfile(): Promise<void> {
    let lf: Lockfile | null = null;
    try {
      lf = parseLockfile(await readFile(this.lockfilePath, 'utf8'));
    } catch {
      lf = null;
    }
    this.lockfile = lf;
    const present = lf !== null;
    if (present !== this.present) {
      this.present = present;
      if (!present) this.phase = null;
      this.ev.onLockfile(present);
    }
  }

  private async pollPhase(lf: Lockfile): Promise<void> {
    const base = lcuBaseUrl(lf);
    const auth = lcuAuthHeader(lf);
    let phase: string;
    try {
      const res = await lcuGet(base, auth, LCU_ENDPOINTS.gameflowPhase);
      if (res.status !== 200) return;
      phase = JSON.parse(res.body) as string;
    } catch {
      this.lockfile = null; // client restarting: re-read the lockfile next tick
      return;
    }
    if (typeof phase !== 'string' || phase === this.phase) return;
    this.phase = phase;
    this.ev.onPhase(phase);
    if (IN_GAME.has(phase)) {
      try {
        const res = await lcuGet(base, auth, LCU_ENDPOINTS.gameflowSession);
        if (res.status !== 200) return;
        const s = JSON.parse(res.body) as {
          gameData?: { gameId?: number; queue?: { id?: number; gameMode?: string; mapId?: number } };
          map?: { id?: number };
        };
        this.ev.onSession({
          gameId: s.gameData?.gameId ? String(s.gameData.gameId) : null,
          queueId: s.gameData?.queue?.id ?? null,
          gameMode: s.gameData?.queue?.gameMode ?? null,
          mapId: s.gameData?.queue?.mapId ?? s.map?.id ?? null,
        });
      } catch {
        /* session is optional */
      }
    }
  }
}
