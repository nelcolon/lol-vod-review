import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleepTimer } from 'node:timers/promises';
import {
  EventDataSchema,
  GameStatsSchema,
  GameflowPhaseResponseSchema,
  GameflowSessionSchema,
  LCU_ENDPOINTS,
  LIVE_CLIENT_BASE_URL,
  LIVE_CLIENT_ENDPOINTS,
  PlayerListSchema,
  ActivePlayerNameSchema,
  lcuAuthHeader,
  lcuBaseUrl,
  parseLockfile,
  playerGameName,
  type Lockfile,
} from '@lvr/schema';
import { EventDeduper } from './dedupe.js';
import { errorInfo, isTlsError } from './http.js';
import { Summarizer, type EndReason, type Summary } from './summary.js';
import type { AttemptRecord, Fetcher, TlsMode } from './types.js';
import { JsonlWriter, sessionFolderName } from './writer.js';

export interface RecorderOptions {
  /** Parent folder; the session folder `<YYYYMMDD-HHMMSS>` is created inside it. */
  outRoot: string;
  fetch: Fetcher;
  lcu: boolean;
  lockfilePath: string;
  liveBaseUrl?: string;
  tls?: TlsMode;
  maxSeconds?: number;
  log?: (line: string) => void;
  /** Timing knobs (defaults match the Phase 0 spec; tests shrink them). */
  timing?: Partial<Timing>;
  now?: () => number;
  hrtime?: () => bigint;
}

export interface Timing {
  lcuIntervalMs: number;
  fastIntervalMs: number;
  slowIntervalMs: number;
  snapshotEveryMs: number;
  gameEndGraceMs: number;
  goneAfterMs: number;
  requestTimeoutMs: number;
  minStallMs: number;
  watchdogMs: number;
}

const DEFAULT_TIMING: Timing = {
  lcuIntervalMs: 1000,
  fastIntervalMs: 250,
  slowIntervalMs: 1000,
  snapshotEveryMs: 30_000,
  gameEndGraceMs: 10_000,
  goneAfterMs: 15_000,
  requestTimeoutMs: 2000,
  minStallMs: 1000,
  watchdogMs: 250,
};

const LIVE_PHASES = new Set(['GameStart', 'InProgress', 'Reconnect']);

export interface RecorderResult {
  outDir: string;
  summary: Summary;
}

export class Recorder {
  private readonly t: Timing;
  private readonly now: () => number;
  private readonly hrtime: () => bigint;
  private readonly log: (line: string) => void;
  private readonly liveBase: string;
  private tls: TlsMode;
  private readonly abort = new AbortController();
  private readonly loops: Promise<void>[] = [];
  private liveStarted = false;
  private stopReason: EndReason | null = null;
  private stopResolve!: () => void;
  private readonly stopped = new Promise<void>((r) => (this.stopResolve = r));
  private startWallMs = 0;
  private outDir = '';
  private files!: Record<'gameflow' | 'gamestats' | 'eventdata' | 'playerlist' | 'probe', JsonlWriter>;
  private summary!: Summarizer;
  private readonly dedupe = new EventDeduper();
  private lockfile: Lockfile | null = null;
  private lockfileState: 'unknown' | 'found' | 'missing' | 'invalid' = 'unknown';
  private lastPhase: string | null = null;
  private lastSnapshotMs = -Infinity;
  private lastEventBody: unknown;
  private lastEventStamp: AttemptRecord | null = null;
  private readonly lastBodyText = new Map<string, string>();
  private gameEndAtMs: number | null = null;
  /** Wall time of the latest HTTP response (any status) from 2999. */
  private lastLiveAnswerMs: number | null = null;

  constructor(private readonly o: RecorderOptions) {
    this.t = { ...DEFAULT_TIMING, ...o.timing };
    this.now = o.now ?? Date.now;
    this.hrtime = o.hrtime ?? process.hrtime.bigint;
    this.log = o.log ?? ((l) => console.log(l));
    this.liveBase = o.liveBaseUrl ?? LIVE_CLIENT_BASE_URL;
    this.tls = o.tls ?? 'riot-ca';
  }

  /** Request a stop (Ctrl-C, max-seconds, ...). Idempotent. */
  stop(reason: EndReason): void {
    if (this.stopReason) return;
    this.stopReason = reason;
    this.abort.abort();
    this.stopResolve();
  }

  async run(): Promise<RecorderResult> {
    this.startWallMs = this.now();
    this.outDir = await uniqueDir(join(this.o.outRoot, sessionFolderName(new Date(this.startWallMs))));
    await mkdir(this.outDir, { recursive: true });
    const f = (n: string) => new JsonlWriter(join(this.outDir, `${n}.jsonl`));
    this.files = { gameflow: f('gameflow'), gamestats: f('gamestats'), eventdata: f('eventdata'), playerlist: f('playerlist'), probe: f('probe') };
    this.summary = new Summarizer(this.startWallMs, this.o.lcu, this.t.minStallMs);
    this.note('session-start', { lcu: this.o.lcu, lockfile: this.o.lcu ? this.o.lockfilePath : undefined, liveBase: this.liveBase, tls: this.tls, maxSeconds: this.o.maxSeconds });
    this.log(`event-dump: writing ${this.outDir}`);

    if (this.o.lcu) this.loops.push(this.loop('lcu', this.t.lcuIntervalMs, () => this.pollLcu()));
    else this.startLive('--no-lcu');
    this.loops.push(this.loop('watchdog', this.t.watchdogMs, async () => this.checkStop()));

    await this.stopped;
    await Promise.allSettled(this.loops);
    return this.finish();
  }

  // ---------------------------------------------------------------- loops

  private loop(name: string, intervalMs: number, fn: () => Promise<void>): Promise<void> {
    return (async () => {
      while (!this.abort.signal.aborted) {
        const t0 = this.now();
        try {
          await fn();
        } catch (e) {
          this.note('internal-error', { loop: name, ...errorInfo(e) });
        }
        const wait = Math.max(0, intervalMs - (this.now() - t0));
        try {
          await sleepTimer(wait, undefined, { signal: this.abort.signal });
        } catch {
          return;
        }
      }
    })();
  }

  private checkStop(): void {
    const now = this.now();
    if (this.o.maxSeconds !== undefined && now - this.startWallMs >= this.o.maxSeconds * 1000) return this.stop('max-seconds');
    if (this.gameEndAtMs !== null && now - this.gameEndAtMs >= this.t.gameEndGraceMs) return this.stop('game-end');
    const last = this.lastLiveAnswerMs;
    if (last !== null && now - last >= this.t.goneAfterMs) return this.stop('2999-gone');
  }

  private startLive(why: string): void {
    if (this.liveStarted) return;
    this.liveStarted = true;
    this.note('live-polling-start', { why });
    this.log(`event-dump: polling ${this.liveBase} (${why})`);
    const ep = LIVE_CLIENT_ENDPOINTS;
    this.loops.push(
      this.loop('gamestats', this.t.fastIntervalMs, () => this.pollGamestats(ep.gamestats)),
      this.loop('eventdata', this.t.fastIntervalMs, () => this.pollEventdata(ep.eventdata)),
      this.loop('playerlist', this.t.slowIntervalMs, () => this.pollPlayerlist(ep.playerlist)),
      this.loop('activeplayername', this.t.slowIntervalMs, () => this.pollActivePlayerName(ep.activeplayername)),
    );
  }

  // ---------------------------------------------------------------- http

  private async attempt(endpoint: string, url: string, live: boolean, headers?: Record<string, string>): Promise<AttemptRecord> {
    const tls: TlsMode = live ? this.tls : 'insecure';
    const wallMs = this.now();
    const s = this.hrtime();
    try {
      const res = await this.o.fetch({ url, tls, timeoutMs: this.t.requestTimeoutMs, ...(headers ? { headers } : {}) });
      const e = this.hrtime();
      return { endpoint, url, wallMs, hrtimeNs_start: s.toString(), hrtimeNs_end: e.toString(), status: res.status, durationMs: Number(e - s) / 1e6, body: parseBody(res.body), tls };
    } catch (err) {
      const e = this.hrtime();
      const info = errorInfo(err);
      if (live && tls === 'riot-ca' && isTlsError(info.code)) {
        this.tls = 'insecure';
        this.note('tls-fallback', { from: 'riot-ca', to: 'insecure', ...info });
        this.log(`event-dump: RIOT_CA_PEM verification failed (${info.code}); falling back to rejectUnauthorized:false`);
      }
      return { endpoint, url, wallMs, hrtimeNs_start: s.toString(), hrtimeNs_end: e.toString(), status: null, durationMs: Number(e - s) / 1e6, error: info, tls };
    }
  }

  private async live(endpoint: string): Promise<AttemptRecord> {
    const name = endpoint.split('/').pop() as string;
    const a = await this.attempt(name, this.liveBase + endpoint, true);
    this.summary.onLiveAttempt(a);
    if (a.status !== 200) this.files.probe.write({ type: 'attempt', ...a });
    if (a.status !== null) {
      if (this.lastLiveAnswerMs === null) this.log(`event-dump: 2999 first answered: ${name} HTTP ${a.status}`);
      this.lastLiveAnswerMs = this.now();
    }
    return a;
  }

  // ---------------------------------------------------------------- 2999 endpoints

  private async pollGamestats(endpoint: string): Promise<void> {
    const a = await this.live(endpoint);
    this.files.gamestats.write(a);
    if (a.status !== 200) return;
    const r = GameStatsSchema.safeParse(a.body);
    if (r.success) this.summary.onGameStats(r.data, a);
    else this.invalid('gamestats', a, r.error.issues);
  }

  private async pollEventdata(endpoint: string): Promise<void> {
    const a = await this.live(endpoint);
    if (a.status !== 200) return;
    const body = a.body as { Events?: unknown } | undefined;
    const events = body && Array.isArray(body.Events) ? (body.Events as unknown[]) : null;
    if (!events) {
      this.invalid('eventdata', a, 'no Events array');
      return;
    }
    if (!EventDataSchema.safeParse(body).success) this.summary.onValidationFailure('eventdata');
    this.lastEventBody = a.body;
    this.lastEventStamp = a;
    const { fresh, shrunk, length } = this.dedupe.ingest(events);
    this.summary.onEventArray(shrunk);
    if (shrunk) this.note('eventdata-shrunk', { length, wallMs: a.wallMs });
    const stamp = { wallMs: a.wallMs, hrtimeNs_start: a.hrtimeNs_start, hrtimeNs_end: a.hrtimeNs_end };
    for (const f of fresh) {
      const p = f.parsed;
      const known = p ? !('unknown' in p) : false;
      this.files.eventdata.write({
        type: 'event',
        ...stamp,
        event: f.raw,
        known,
        ...(p && 'unknown' in p ? { unknownReason: p.reason } : {}),
        ...(f.idConflict ? { idConflict: f.idConflict } : {}),
      });
      const label = p ? `${p.EventName}#${p.EventID} @${p.EventTime.toFixed(1)}s` : JSON.stringify(f.raw);
      this.log(`event: ${label}${known ? '' : '  [UNKNOWN/INVALID]'}${f.idConflict ? '  [EventID reused]' : ''}`);
      if (p && known && p.EventName === 'GameEnd' && this.gameEndAtMs === null) {
        this.gameEndAtMs = this.now();
        this.log(`event-dump: GameEnd seen, stopping in ${this.t.gameEndGraceMs / 1000} s`);
      }
    }
    this.summary.onFreshEvents(fresh, a);
    if (a.wallMs - this.lastSnapshotMs >= this.t.snapshotEveryMs) this.snapshot(a, a.body, 'periodic');
  }

  private snapshot(stamp: AttemptRecord, body: unknown, why: string): void {
    this.lastSnapshotMs = stamp.wallMs;
    const count = (body as { Events?: unknown[] }).Events?.length ?? null;
    this.files.eventdata.write({ type: 'snapshot', why, wallMs: stamp.wallMs, hrtimeNs_start: stamp.hrtimeNs_start, hrtimeNs_end: stamp.hrtimeNs_end, status: stamp.status, count, body });
  }

  private writeDedupedBody(file: JsonlWriter, a: AttemptRecord): void {
    const text = JSON.stringify(a.body);
    if (a.status === 200 && this.lastBodyText.get(a.endpoint) === text) {
      const { body: _b, ...rest } = a;
      file.write({ ...rest, sameAsPrevious: true });
    } else {
      if (a.status === 200) this.lastBodyText.set(a.endpoint, text);
      file.write(a);
    }
  }

  private async pollPlayerlist(endpoint: string): Promise<void> {
    const a = await this.live(endpoint);
    this.writeDedupedBody(this.files.playerlist, a);
    if (a.status !== 200) return;
    const r = PlayerListSchema.safeParse(a.body);
    if (r.success) this.summary.onPlayerNames(r.data.map(playerGameName).filter((n): n is string => !!n));
    else this.invalid('playerlist', a, r.error.issues);
  }

  private async pollActivePlayerName(endpoint: string): Promise<void> {
    const a = await this.live(endpoint);
    this.writeDedupedBody(this.files.playerlist, a);
    if (a.status === 200 && !ActivePlayerNameSchema.safeParse(a.body).success) this.invalid('activeplayername', a, 'not a string');
  }

  private invalid(endpoint: string, a: AttemptRecord, issues: unknown): void {
    this.summary.onValidationFailure(endpoint);
    this.files.probe.write({ type: 'schema-invalid', endpoint, wallMs: a.wallMs, hrtimeNs_start: a.hrtimeNs_start, issues });
  }

  // ---------------------------------------------------------------- LCU

  private async readLockfile(): Promise<Lockfile | null> {
    let next: typeof this.lockfileState;
    let lf: Lockfile | null = null;
    let detail: Record<string, unknown> = {};
    try {
      lf = parseLockfile(await readFile(this.o.lockfilePath, 'utf8'));
      next = 'found';
      detail = { port: lf.port, pid: lf.pid, processName: lf.processName, protocol: lf.protocol };
    } catch (e) {
      const info = errorInfo(e);
      next = info.code === 'ENOENT' ? 'missing' : 'invalid';
      detail = info;
    }
    if (next !== this.lockfileState) {
      this.lockfileState = next;
      this.note(`lockfile-${next}`, { path: this.o.lockfilePath, ...detail });
      this.log(`event-dump: lockfile ${next} (${this.o.lockfilePath})`);
    }
    this.summary.onLockfile(next === 'found');
    return lf;
  }

  private async pollLcu(): Promise<void> {
    this.lockfile ??= await this.readLockfile();
    const lf = this.lockfile;
    if (!lf) return;
    const headers = { Authorization: lcuAuthHeader(lf) };
    const a = await this.attempt('gameflow-phase', lcuBaseUrl(lf) + LCU_ENDPOINTS.gameflowPhase, false, headers);
    if (a.status !== 200) {
      this.files.probe.write({ type: 'lcu-attempt', ...a, url: a.url });
      if (a.status === null) this.lockfile = null; // client restarted? re-read lockfile next tick
      return;
    }
    const r = GameflowPhaseResponseSchema.safeParse(a.body);
    if (!r.success) {
      this.files.probe.write({ type: 'schema-invalid', endpoint: 'gameflow-phase', wallMs: a.wallMs, body: a.body });
      return;
    }
    const phase = r.data;
    if (phase !== this.lastPhase) {
      const prev = this.lastPhase;
      this.lastPhase = phase;
      this.files.gameflow.write({ type: 'phase', phase, prev, wallMs: a.wallMs, iso: new Date(a.wallMs).toISOString(), hrtimeNs: a.hrtimeNs_start, hrtimeNs_end: a.hrtimeNs_end });
      this.summary.onPhase(phase, a.wallMs);
      this.log(`gameflow: ${prev ?? '(start)'} -> ${phase}  ${new Date(a.wallMs).toISOString()}  hrtime=${a.hrtimeNs_start}`);
      if (LIVE_PHASES.has(phase)) {
        await this.fetchSession(lf, headers);
        this.startLive(`gameflow=${phase}`);
      }
    }
  }

  private async fetchSession(lf: Lockfile, headers: Record<string, string>): Promise<void> {
    const a = await this.attempt('gameflow-session', lcuBaseUrl(lf) + LCU_ENDPOINTS.gameflowSession, false, headers);
    this.files.gameflow.write({ type: 'session', ...a });
    if (a.status !== 200) return;
    const r = GameflowSessionSchema.safeParse(a.body);
    if (!r.success) {
      this.summary.onValidationFailure('gameflow-session');
      return;
    }
    const s = r.data;
    this.summary.onSession({
      phase: String(s.phase),
      ...(s.gameData?.gameId !== undefined ? { gameId: s.gameData.gameId } : {}),
      ...(s.gameData?.queue?.id !== undefined ? { queueId: s.gameData.queue.id } : {}),
      ...(s.gameData?.queue?.gameMode !== undefined ? { gameMode: s.gameData.queue.gameMode } : {}),
      ...(s.map?.id !== undefined ? { mapId: s.map.id } : {}),
    });
  }

  // ---------------------------------------------------------------- end

  private note(type: string, data: Record<string, unknown>): void {
    const wallMs = this.now();
    this.files.probe.write({ type, wallMs, iso: new Date(wallMs).toISOString(), hrtimeNs: this.hrtime().toString(), ...data });
  }

  private async finish(): Promise<RecorderResult> {
    const reason = this.stopReason ?? 'error';
    if (this.lastEventStamp) this.snapshot(this.lastEventStamp, this.lastEventBody, 'final');
    this.note('session-end', { reason });
    const summary = this.summary.finalize(reason, this.now());
    await Promise.all(Object.values(this.files).map((w) => w.close()));
    await writeFile(join(this.outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    return { outDir: this.outDir, summary };
  }
}

function parseBody(text: string): unknown {
  if (text === '') return '';
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function uniqueDir(base: string): Promise<string> {
  for (let i = 1; ; i++) {
    const dir = i === 1 ? base : `${base}-${i}`;
    try {
      await access(dir);
    } catch {
      return dir;
    }
  }
}
