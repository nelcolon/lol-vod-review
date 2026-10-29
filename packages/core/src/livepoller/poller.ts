/**
 * Live Client Data poller (PLAN §3.3/§3.4).
 *
 * Polls `/gamestats` + `/eventdata` at `hz` (default 2) and `/playerlist` at `playerlistHz`
 * (default 1). Every request is stamped with the injected monotonic clock before and after;
 * the midpoint is the host timestamp of the sample. Events are cumulative on 2999, so we
 * dedupe on `EventID`. 404 / ECONNREFUSED before the first success (loading screen) are
 * silent; after the first success a failure streak longer than `lostAfterMs` fires `onLost`.
 *
 * Pure: fetch, clock and scheduler are injected. On the Windows host inject a `fetch` that
 * accepts Riot's self-signed certificate (undici `Agent({ connect: { rejectUnauthorized:
 * false } })` or `ca: riotgames.pem`).
 */

import type { Scheduler } from '../lifecycle/runner.js';
import { coerceLiveEvent, type GameStats, type LiveEvent, type PlayerListEntry, type Team } from '../types.js';

export interface HostClock {
  /** Monotonic nanoseconds (QPC-like). `process.hrtime.bigint()` on the host. */
  hrtimeNs(): bigint;
  /** Wall clock ms since epoch. `Date.now()` on the host. */
  nowMs(): number;
}

export const realHostClock: HostClock = {
  hrtimeNs: () => process.hrtime.bigint(),
  nowMs: () => Date.now(),
};

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponseLike>;

export interface GameStatsSample {
  gameTime: number;
  hostNsStart: bigint;
  hostNsEnd: bigint;
  /** Midpoint of the request — use this with `ClockMapper.addSample`. */
  hostNsMid: bigint;
  wallMs: number;
  stats: GameStats;
}

export interface TimedLiveEvent {
  event: LiveEvent;
  /** Midpoint of the `/eventdata` request that first showed the event. */
  observedHostNs: bigint;
  /** Latest known gameTime when the event was observed. */
  observedGameTime: number;
  wallMs: number;
}

export interface PlayerState {
  name: string;
  tagLine: string;
  team: Team;
  championName: string;
  level: number;
  isDead: boolean;
  respawnTimer: number;
  position: string;
  scores: { kills: number; deaths: number; assists: number; creepScore: number; wardScore: number } | null;
}

export interface PlayerListSnapshot {
  hostNs: bigint;
  wallMs: number;
  gameTime: number;
  activePlayerName: string | null;
  players: PlayerState[];
}

export interface PollerError {
  endpoint: string;
  status: number | null;
  error: unknown;
}

export interface LiveClientPollerOptions {
  fetch: FetchLike;
  clock: HostClock;
  scheduler: Scheduler;
  /** Default `https://127.0.0.1:2999/liveclientdata`. */
  baseUrl?: string;
  /** Gamestats + eventdata polls per second. Default 2. */
  hz?: number;
  /** Playerlist polls per second. Default 1. */
  playerlistHz?: number;
  /** Failure streak length (ms) after a success before `onLost`. Default 8000. */
  lostAfterMs?: number;
  /** Per-request timeout. Default 2000. 0 disables. */
  requestTimeoutMs?: number;

  onFirstResponse?: (sample: GameStatsSample) => void;
  onGameStats?: (sample: GameStatsSample) => void;
  onEvent?: (event: TimedLiveEvent) => void;
  onEvents?: (events: TimedLiveEvent[]) => void;
  onPlayerList?: (snapshot: PlayerListSnapshot) => void;
  /** Active player name resolved (null when the game is spectated/replayed: 2999 answers 400). */
  onActivePlayer?: (name: string | null, spectator: boolean) => void;
  onLost?: () => void;
  onError?: (err: PollerError) => void;
}

export class LiveClientPoller {
  private readonly baseUrl: string;
  private readonly periodMs: number;
  private readonly playerlistEvery: number;
  private readonly lostAfterMs: number;
  private readonly requestTimeoutMs: number;

  private running = false;
  private timer: unknown = null;
  private tickCount = 0;
  private inFlight: Promise<void> | null = null;

  private up = false;
  private lastSuccessMs: number | null = null;
  private failureStreak = 0;
  private lastGameTime = 0;
  private seen = new Set<number>();
  private activePlayerName: string | null = null;
  private activePlayerResolved = false;
  private spectator = false;

  constructor(private readonly opts: LiveClientPollerOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://127.0.0.1:2999/liveclientdata').replace(/\/$/, '');
    const hz = opts.hz ?? 2;
    this.periodMs = Math.max(50, Math.round(1000 / hz));
    this.playerlistEvery = Math.max(1, Math.round(hz / (opts.playerlistHz ?? 1)));
    this.lostAfterMs = opts.lostAfterMs ?? 8000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 2000;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** True between the first successful response and `onLost`. */
  get isUp(): boolean {
    return this.up;
  }

  get knownEventIds(): ReadonlySet<number> {
    return this.seen;
  }

  get activePlayer(): string | null {
    return this.activePlayerName;
  }

  get isSpectator(): boolean {
    return this.spectator;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tickCount = 0;
    this.scheduleTick(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      this.opts.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    this.up = false;
    this.lastSuccessMs = null;
    this.failureStreak = 0;
  }

  /** Forget seen EventIDs (a brand-new game in the same poller instance). */
  resetEvents(): void {
    this.seen = new Set();
    this.activePlayerName = null;
    this.activePlayerResolved = false;
    this.spectator = false;
    this.lastGameTime = 0;
  }

  /** Run one poll cycle now (used by tests; `start()` calls this on a timer). */
  async tick(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doTick().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private scheduleTick(delayMs: number): void {
    if (!this.running) return;
    this.timer = this.opts.scheduler.setTimeout(() => {
      this.timer = null;
      const started = this.opts.clock.nowMs();
      void this.tick().then(() => {
        const elapsed = this.opts.clock.nowMs() - started;
        this.scheduleTick(Math.max(0, this.periodMs - elapsed));
      });
    }, delayMs);
  }

  private async doTick(): Promise<void> {
    const tickIndex = this.tickCount++;
    const stats = await this.timed<GameStats>('/gamestats');
    if (!stats.ok) {
      this.onFailure('/gamestats', stats.status, stats.error);
      return;
    }
    const gameTime = typeof stats.body.gameTime === 'number' ? stats.body.gameTime : Number(stats.body.gameTime);
    if (!Number.isFinite(gameTime)) {
      this.onFailure('/gamestats', stats.status, new Error('gamestats without numeric gameTime'));
      return;
    }
    this.lastGameTime = gameTime;
    const sample: GameStatsSample = {
      gameTime,
      hostNsStart: stats.t0,
      hostNsEnd: stats.t1,
      hostNsMid: mid(stats.t0, stats.t1),
      wallMs: stats.wallMs,
      stats: stats.body,
    };
    const wasUp = this.up;
    this.onSuccess();
    if (!wasUp) this.opts.onFirstResponse?.(sample);
    this.opts.onGameStats?.(sample);

    await this.pollEvents();

    if (tickIndex % this.playerlistEvery === 0) await this.pollPlayerList();

    if (!this.activePlayerResolved) await this.pollActivePlayerName();
  }

  private async pollEvents(): Promise<void> {
    const res = await this.timed<{ Events?: unknown[] }>('/eventdata');
    if (!res.ok) {
      this.onFailure('/eventdata', res.status, res.error);
      return;
    }
    const raw = Array.isArray(res.body.Events) ? res.body.Events : [];
    const observedHostNs = mid(res.t0, res.t1);
    const fresh: TimedLiveEvent[] = [];
    for (const r of raw) {
      const ev = coerceLiveEvent(r);
      if (!ev) continue;
      if (this.seen.has(ev.EventID)) continue;
      this.seen.add(ev.EventID);
      fresh.push({ event: ev, observedHostNs, observedGameTime: this.lastGameTime, wallMs: res.wallMs });
    }
    if (fresh.length === 0) return;
    fresh.sort((a, b) => a.event.EventID - b.event.EventID);
    for (const e of fresh) this.opts.onEvent?.(e);
    this.opts.onEvents?.(fresh);
  }

  private async pollPlayerList(): Promise<void> {
    if (!this.opts.onPlayerList) return;
    const res = await this.timed<unknown>('/playerlist');
    if (!res.ok) {
      this.onFailure('/playerlist', res.status, res.error);
      return;
    }
    const list = Array.isArray(res.body) ? (res.body as Partial<PlayerListEntry>[]) : [];
    const players: PlayerState[] = [];
    for (const p of list) {
      const name = p.riotIdGameName ?? p.summonerName;
      if (typeof name !== 'string') continue;
      players.push({
        name,
        tagLine: typeof p.riotIdTagLine === 'string' ? p.riotIdTagLine : '',
        team: p.team === 'CHAOS' ? 'CHAOS' : 'ORDER',
        championName: typeof p.championName === 'string' ? p.championName : '',
        level: typeof p.level === 'number' ? p.level : 0,
        isDead: Boolean(p.isDead),
        respawnTimer: typeof p.respawnTimer === 'number' ? p.respawnTimer : 0,
        position: typeof p.position === 'string' ? p.position : '',
        scores: p.scores ?? null,
      });
    }
    this.opts.onPlayerList({
      hostNs: mid(res.t0, res.t1),
      wallMs: res.wallMs,
      gameTime: this.lastGameTime,
      activePlayerName: this.activePlayerName,
      players,
    });
  }

  private async pollActivePlayerName(): Promise<void> {
    const res = await this.timed<unknown>('/activeplayername');
    if (res.ok && typeof res.body === 'string' && res.body.length > 0) {
      this.activePlayerName = res.body;
      this.activePlayerResolved = true;
      this.spectator = false;
      this.opts.onActivePlayer?.(this.activePlayerName, false);
      return;
    }
    if (!res.ok && res.status === 400) {
      // "Spectator mode doesn't currently support this feature"
      this.activePlayerResolved = true;
      this.spectator = true;
      this.opts.onActivePlayer?.(null, true);
    }
    // Any other failure: retry next tick, silently.
  }

  private onSuccess(): void {
    this.up = true;
    this.lastSuccessMs = this.opts.clock.nowMs();
    this.failureStreak = 0;
  }

  private onFailure(endpoint: string, status: number | null, error: unknown): void {
    if (!this.up) return; // loading screen: 404 / ECONNREFUSED are expected
    this.failureStreak += 1;
    if (this.failureStreak === 1) this.opts.onError?.({ endpoint, status, error });
    const since = this.opts.clock.nowMs() - (this.lastSuccessMs ?? 0);
    if (since >= this.lostAfterMs) {
      this.up = false;
      this.failureStreak = 0;
      this.opts.onLost?.();
    }
  }

  private async timed<T>(
    path: string,
  ): Promise<{ ok: true; body: T; status: number; t0: bigint; t1: bigint; wallMs: number } | { ok: false; status: number | null; error: unknown; t0: bigint; t1: bigint }> {
    const url = `${this.baseUrl}${path}`;
    const controller = this.requestTimeoutMs > 0 && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? this.opts.scheduler.setTimeout(() => controller.abort(), this.requestTimeoutMs) : null;
    const wallMs = this.opts.clock.nowMs();
    const t0 = this.opts.clock.hrtimeNs();
    try {
      const res = await this.opts.fetch(url, controller ? { signal: controller.signal } : undefined);
      const t1 = this.opts.clock.hrtimeNs();
      if (!res.ok) return { ok: false, status: res.status, error: null, t0, t1 };
      const body = (await res.json()) as T;
      return { ok: true, body, status: res.status, t0, t1, wallMs };
    } catch (error) {
      return { ok: false, status: null, error, t0, t1: this.opts.clock.hrtimeNs() };
    } finally {
      if (timeout !== null) this.opts.scheduler.clearTimeout(timeout);
    }
  }
}

function mid(a: bigint, b: bigint): bigint {
  return (a + b) / 2n;
}
