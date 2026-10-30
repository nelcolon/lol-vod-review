/**
 * CoreBackend — the real `Backend` (PLAN §3, Phase 1): `@lvr/core` lifecycle + Live Client
 * poller + clock mapper + SQLite store, the LCU watcher, and the `lvr-recorder` sidecar.
 *
 * Flow per game: LCU phase → LOADING (start polling 2999) → first 2999 response →
 * RECORDING (recorder `start` on the League window) → GameEnd / 2999 gone → stop recorder
 * → post-process (normalize events onto video, compute moments, store) → ready.
 *
 * Raw Live Client events of every game are also appended to `events.jsonl` next to the
 * video (replay/spectate drops objective events, so the live log is the source of truth).
 */
import { appendFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ClockMapper,
  GameStore,
  LifecycleRunner,
  LiveClientPoller,
  computeMoments,
  normalizeEvents,
  openDatabase,
  realHostClock,
  realScheduler,
  type LifecycleContext,
  type LifecycleEffect,
  type LiveEvent,
  type PlayerListSnapshot,
  type PlayerSnapshot,
  type RecordingSettings,
  type SegmentRef,
  type Team,
} from '@lvr/core';
import type { Backend } from './backend';
import { Ddragon } from './core/ddragon';
import { destroyAgents, liveFetch } from './core/http';
import { LcuWatcher, type LcuSessionInfo } from './core/lcu';
import { kdaOf, mapClip, mapEvent, mapGame, mapMoment, mapNote, mapSegment, type Me } from './core/mapping';
import { computePlayState, involvedIn, killsIn, readPlayersLog, type LcuTimeline, type SavedPlayer } from './core/playstate';
import { RecorderSidecar, type StoppedEvent } from './core/recorder';
import type { CauseTag, Clip, ClipBundle, Game, GameBundle, Note, NoteInput, PlayState, RecorderStatus, Settings } from '../shared/contracts';
import { BITRATE_PRESETS, CAUSE_TAGS } from '../shared/contracts';

export interface CoreBackendOptions {
  dbPath: string;
  recordingsDir: string;
  recorderExe: string;
  mediaRoots: string[];
  /** Data Dragon cache (item names/costs). */
  ddragonDir: string;
}

/** Live-game state that only exists between LOADING and the end of post-processing. */
interface LiveGame {
  rowId: number | null;
  riotGameId: string | null;
  dir: string | null;
  startedAt: number;
  clock: ClockMapper;
  events: LiveEvent[];
  snapshots: PlayerSnapshot[];
  lastPlayers: PlayerListSnapshot | null;
  /** Last players line written to players.jsonl, to only write changes. */
  playersDigest: string;
  lastGold: number | null;
  activePlayer: string | null;
  gameMode: string | null;
  queueId: number | null;
  /** Open segment: row id + host ns of its first frame. */
  segments: Array<{ rowId: number; startNs: bigint; endNs: bigint | null }>;
  pendingStop: Promise<unknown> | null;
}

const SR = [400, 420, 430, 440, 490];

function recordingSettings(s: Settings): RecordingSettings {
  return {
    summonersRift: SR.some((q) => s.queues.includes(q)),
    aram: s.queues.includes(450),
    arena: s.queues.includes(1700),
    practiceTool: s.queues.includes(3140),
    custom: s.queues.includes(0),
    spectate: false,
    otherModes: false,
    unknown: true,
  };
}

export class CoreBackend implements Backend {
  private store!: GameStore;
  private readonly recSettings: RecordingSettings = recordingSettings({ queues: [] } as unknown as Settings);
  private settings: Settings | null = null;
  private runner!: LifecycleRunner;
  private poller!: LiveClientPoller;
  private lcu!: LcuWatcher;
  private recorder!: RecorderSidecar;
  private live: LiveGame | null = null;
  private pendingSession: LcuSessionInfo | null = null;
  private status: RecorderStatus = { state: 'idle', gameId: null, sinceIso: null, encoder: null, frames: 0, dropped: 0, enabled: true, detail: 'starting' };
  private readonly listeners = new Set<(s: RecorderStatus) => void>();
  private retryTimer: NodeJS.Timeout | null = null;
  private discarding = false;
  private readonly ddragon: Ddragon;

  constructor(private readonly opts: CoreBackendOptions) {
    this.ddragon = new Ddragon(opts.ddragonDir);
  }

  // --- lifecycle wiring ---------------------------------------------------------------------

  async start(): Promise<void> {
    mkdirSync(this.opts.recordingsDir, { recursive: true });
    this.store = new GameStore(openDatabase(this.opts.dbPath));
    // A crash mid-game leaves rows in 'recording'/'processing'; mark them failed.
    for (const g of this.store.listGames({ status: ['recording', 'processing'] })) {
      if (g.segment_count === 0) this.store.deleteGame(g.id);
      else this.store.updateGame(g.id, { status: 'error' });
    }

    this.runner = new LifecycleRunner({
      settings: this.recSettings,
      // The recorder finds the League window itself (largest window of the exe).
      requireGameWindow: false,
      onEffect: (e, ctx) => this.onEffect(e, ctx),
      onTransition: (from, to, input) => {
        if (from.state !== to.state) console.log(`[lifecycle] ${from.state} -> ${to.state} (${input.type})`);
        // After this input's effects ran: a game that ended without post-processing leaves nothing.
        if (from.state !== to.state) queueMicrotask(() => this.dropUnrecordedGame());
        this.refreshStatus();
      },
    });

    this.poller = new LiveClientPoller({
      fetch: liveFetch,
      clock: realHostClock,
      scheduler: realScheduler,
      hz: 4,
      playerlistHz: 1,
      onFirstResponse: (s) => {
        if (this.live) this.live.gameMode = s.stats.gameMode;
        this.runner.liveOk({ gameMode: s.stats.gameMode, mapId: s.stats.mapNumber });
      },
      onGameStats: (s) => {
        this.live?.clock.addSample(s.gameTime, s.hostNsMid);
        this.runner.liveOk();
      },
      onEvents: (evs) => {
        if (!this.live) return;
        for (const t of evs) {
          this.live.events.push(t.event);
          this.appendEventLog(t);
          if (t.event.EventName === 'GameEnd') {
            const result = String((t.event as { Result?: unknown }).Result ?? '');
            this.runner.dispatch({ type: 'gameEnd', result: result === 'Win' || result === 'Lose' ? result : 'Neither', gameTimeS: t.event.EventTime });
          }
        }
      },
      onPlayerList: (snap) => {
        if (!this.live) return;
        this.live.lastPlayers = snap;
        this.live.snapshots.push({
          gameTime: snap.gameTime,
          players: snap.players.map((p) => ({ name: p.name, isDead: p.isDead, respawnTimer: p.respawnTimer, level: p.level })),
        });
        this.logPlayers(snap);
      },
      onActivePlayer: (name) => {
        if (this.live) this.live.activePlayer = name;
      },
      onError: () => this.runner.liveFailed(),
      onLost: () => this.runner.liveFailed(),
    });

    this.recorder = new RecorderSidecar(this.opts.recorderExe, {
      onStats: (s) => {
        this.status = { ...this.status, frames: s.frames, dropped: s.dropped };
        this.emit();
      },
      onWarning: (w) => console.log(`[recorder] warning ${w.code}${w.detail ? `: ${w.detail}` : ''}`),
      onSpontaneousStop: (s) => {
        this.closeSegment(s);
        this.runner.dispatch({ type: 'gameWindowLost' });
      },
      onExit: (code) => console.log(`[recorder] exited ${code}`),
    });

    this.lcu = new LcuWatcher({
      onLockfile: (present) => this.runner.dispatch({ type: present ? 'lockfileAppeared' : 'lockfileVanished' }),
      onPhase: (phase) => this.runner.dispatch({ type: 'gameflowPhase', phase }),
      onSession: (info) => {
        this.pendingSession = info;
        if (this.live) this.applySession(this.live, info);
        this.runner.dispatch({ type: 'queueInfo', info: { queueId: info.queueId, gameMode: info.gameMode, mapId: info.mapId } });
      },
    });
    this.lcu.start();
    this.refreshStatus();
  }

  async stop(): Promise<void> {
    this.lcu?.stop();
    this.poller?.stop();
    this.runner?.dispose();
    this.recorder?.dispose(); // stdin EOF → the recorder finalizes the MP4
    destroyAgents();
  }

  private onEffect(e: LifecycleEffect, ctx: LifecycleContext): void {
    switch (e.type) {
      case 'startPolling':
        this.live = this.newLiveGame();
        this.poller.stop();
        this.poller.resetEvents();
        this.poller.start();
        break;
      case 'stopPolling':
        this.poller.stop();
        break;
      case 'startRecording':
        void this.startSegment(e.segmentIndex, e.hwnd);
        break;
      case 'stopRecording':
        this.stopSegment();
        break;
      case 'runPostProcess':
        void this.postProcess(e.game.result, e.game.durationS);
        break;
      case 'discardGame':
        void this.discard(e.reason);
        break;
      case 'skipGame':
        console.log(`[lifecycle] not recording: ${e.reason}`);
        this.status = { ...this.status, detail: `not recording: ${e.reason}` };
        this.emit();
        break;
    }
    void ctx;
  }

  private newLiveGame(): LiveGame {
    const g: LiveGame = {
      rowId: null,
      riotGameId: null,
      dir: null,
      startedAt: Date.now(),
      clock: new ClockMapper(),
      events: [],
      snapshots: [],
      lastPlayers: null,
      playersDigest: '',
      lastGold: null,
      activePlayer: null,
      gameMode: null,
      queueId: null,
      segments: [],
      pendingStop: null,
    };
    if (this.pendingSession) this.applySession(g, this.pendingSession);
    return g;
  }

  private applySession(g: LiveGame, info: LcuSessionInfo): void {
    if (info.gameId && !g.riotGameId) g.riotGameId = info.gameId;
    if (info.queueId !== null) g.queueId = info.queueId;
    if (info.gameMode) g.gameMode = info.gameMode;
  }

  // --- recording ------------------------------------------------------------------------------

  private ensureGameRow(g: LiveGame): number {
    if (g.rowId !== null) return g.rowId;
    const riotId = g.riotGameId ?? `local-${g.startedAt}`;
    const existing = this.store.getGameByGameId(riotId);
    const row =
      existing ??
      this.store.insertGame({ game_id: riotId, started_at: g.startedAt, queue_id: g.queueId, game_mode: g.gameMode, status: 'recording' });
    if (existing) this.store.updateGame(existing.id, { status: 'recording' });
    g.rowId = row.id;
    const stamp = new Date(g.startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    g.dir = join(this.opts.recordingsDir, `${stamp}_${riotId}`);
    mkdirSync(g.dir, { recursive: true });
    return row.id;
  }

  private async startSegment(index: number, hwnd: number | null, attempt = 0): Promise<void> {
    const g = this.live;
    if (!g || this.runner.state !== 'RECORDING') return;
    const rowId = this.ensureGameRow(g);
    if (g.pendingStop) await g.pendingStop.catch(() => undefined);
    const preset = BITRATE_PRESETS[this.settings?.bitratePreset ?? '1080p60_12'];
    const out = join(g.dir!, `seg${index}.mp4`);
    try {
      const started = await this.recorder.start({
        target: hwnd ? { hwnd } : { processName: 'League of Legends.exe' },
        out,
        fps: preset.fps,
        bitrateMbps: preset.mbps,
      });
      if (this.live !== g || this.runner.state !== 'RECORDING') {
        // The game ended while the recorder was starting: drop this segment.
        console.warn('[recorder] started after the game ended, stopping');
        await this.recorder.stop().catch(() => undefined);
        rmSync(started.path, { force: true });
        return;
      }
      // QPC ticks → ns: the same clock as process.hrtime.bigint() on Windows.
      const startNs = (BigInt(started.qpcStart) * 1_000_000_000n) / BigInt(started.qpcFreq);
      const seg = this.store.addSegment(rowId, {
        seq: index,
        path: started.path,
        qpc_start: startNs,
        wall_start: Date.parse(started.wallStart),
        width: started.width,
        height: started.height,
        fps: started.fps,
        codec: started.encoder,
      });
      g.segments.push({ rowId: seg.id, startNs, endNs: null });
      this.status = { ...this.status, encoder: started.encoder, frames: 0, dropped: 0 };
      // Lets the lifecycle tell "2999 gone, window still open" (game over) from a crash.
      this.runner.dispatch({ type: 'gameWindowFound', ...(started.hwnd ? { hwnd: started.hwnd } : {}) });
      console.log(`[recorder] started ${started.path} (${started.width}x${started.height}, ${started.encoder})`);
      this.refreshStatus();
    } catch (err) {
      const code = (err as { code?: string }).code;
      console.warn(`[recorder] start failed (${code ?? ''}): ${(err as Error).message}`);
      // The window may not exist yet (loading screen → game); retry for ~30 s.
      if (attempt < 15 && this.runner.state === 'RECORDING') {
        this.retryTimer = setTimeout(() => void this.startSegment(index, hwnd, attempt + 1), 2000);
      } else {
        this.status = { ...this.status, detail: `recorder failed: ${(err as Error).message}` };
        this.emit();
      }
    }
  }

  private stopSegment(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const g = this.live;
    const p = this.recorder
      .stop()
      .then((s) => {
        if (s) this.closeSegment(s);
      })
      .catch((e: unknown) => console.warn(`[recorder] stop failed: ${(e as Error).message}`));
    if (g) g.pendingStop = p;
  }

  private closeSegment(s: StoppedEvent): void {
    const g = this.live;
    const open = g?.segments.find((x) => x.endNs === null);
    if (!g || !open) return;
    open.endNs = open.startNs + BigInt(Math.round(s.durationMs)) * 1_000_000n;
    let size = 0;
    try {
      size = statSync(s.path).size;
    } catch {
      size = 0;
    }
    this.store.updateSegment(open.rowId, { duration_ms: s.durationMs, size_bytes: size });
    console.log(`[recorder] stopped ${s.path} (${(s.durationMs / 1000).toFixed(1)} s, ${s.frames} frames, ${s.reason})`);
  }

  private appendEventLog(t: { event: LiveEvent; observedHostNs: bigint; observedGameTime: number; wallMs: number }): void {
    const g = this.live;
    if (!g || !this.runner.context.recordingEnabled) return;
    try {
      this.ensureGameRow(g);
      appendFileSync(
        join(g.dir!, 'events.jsonl'),
        `${JSON.stringify({ ...t.event, observedHostNs: String(t.observedHostNs), observedGameTime: t.observedGameTime, wallMs: t.wallMs })}\n`,
      );
    } catch (e) {
      console.warn(`[events] log write failed: ${(e as Error).message}`);
    }
  }

  /** players.jsonl: everyone's items/level/score when they change, and my gold (game state panel). */
  private logPlayers(snap: PlayerListSnapshot): void {
    const g = this.live;
    if (!g || !this.runner.context.recordingEnabled || snap.gameTime <= 0) return;
    const players: SavedPlayer[] = snap.players.map((p) => ({
      name: p.name,
      champion: p.championName,
      championKey: p.championKey,
      team: p.team,
      position: p.position,
      level: p.level,
      isDead: p.isDead,
      kills: p.scores?.kills ?? 0,
      deaths: p.scores?.deaths ?? 0,
      assists: p.scores?.assists ?? 0,
      items: p.items,
      spells: p.spells,
    }));
    const t = Math.round(snap.gameTime * 10) / 10;
    try {
      this.ensureGameRow(g);
      const file = join(g.dir!, 'players.jsonl');
      const digest = JSON.stringify(players);
      if (digest !== g.playersDigest) {
        g.playersDigest = digest;
        appendFileSync(file, `${JSON.stringify({ t, players })}\n`);
      }
      void liveFetch('https://127.0.0.1:2999/liveclientdata/activeplayer')
        .then(async (r) => (r.ok ? ((await r.json()) as { currentGold?: unknown }).currentGold : null))
        .then((gold) => {
          if (typeof gold !== 'number' || this.live !== g) return;
          const rounded = Math.floor(gold);
          if (rounded === g.lastGold) return;
          g.lastGold = rounded;
          appendFileSync(file, `${JSON.stringify({ t, gold: rounded })}\n`);
        })
        .catch(() => undefined);
    } catch (e) {
      console.warn(`[players] log write failed: ${(e as Error).message}`);
    }
  }

  // --- post-game ------------------------------------------------------------------------------

  private async postProcess(result: string | null, durationS: number | null): Promise<void> {
    const g = this.live;
    try {
      if (!g || g.rowId === null) return;
      if (g.pendingStop) await g.pendingStop;
      const rowId = g.rowId;
      this.store.updateGame(rowId, { status: 'processing' });
      this.refreshStatus();

      const segments: SegmentRef[] = g.segments.map((s) => ({ id: s.rowId, startNs: s.startNs, endNs: s.endNs }));
      const rows = normalizeEvents(g.events, { gameId: String(rowId), clock: g.clock, segments });

      const me = this.resolveMe(g);
      const players = g.lastPlayers?.players ?? [];
      this.store.transaction(() => {
        this.store.bulkInsertEvents(rowId, rows);
        if (players.length) {
          this.store.upsertParticipants(
            rowId,
            players.map((p, slot) => ({ slot, riot_id_name: p.name, puuid: null, team: p.team, champion: p.championName, role: p.position || null })),
          );
        }
        if (me) {
          const moments = computeMoments({
            events: rows,
            me: { name: me.name, team: me.team },
            participants: players.map((p) => ({ name: p.name, team: p.team, champion: p.championName })),
            playerSnapshots: g.snapshots,
            config: { preRollS: this.settings?.preRollS ?? 10 },
          });
          this.store.replaceMoments(rowId, moments);
          this.store.putTimeline(rowId, 'lvr_me', { name: me.name, team: me.team });
        }
        const mine = players.find((p) => p.name === me?.name);
        const lastGameTime = g.clock.stats().pieces.at(-1)?.gameTimeEndS ?? null;
        this.store.updateGame(rowId, {
          status: 'ready',
          ended_at: Date.now(),
          result,
          duration_s: durationS ?? lastGameTime,
          game_mode: g.gameMode,
          queue_id: g.queueId,
          my_champion: mine?.championName ?? null,
          my_role: mine?.position || null,
        });
      });
      console.log(`[post] game ${rowId}: ${rows.length} events, me=${me?.name ?? '?'}`);
    } catch (e) {
      console.error(`[post] failed: ${(e as Error).stack ?? String(e)}`);
      if (g?.rowId) this.store.updateGame(g.rowId, { status: 'error' });
    } finally {
      this.live = null;
      this.pendingSession = null;
      this.runner.dispatch({ type: 'postProcessDone' });
      this.refreshStatus();
    }
  }

  private resolveMe(g: LiveGame): { name: string; team: Team } | null {
    const full = g.activePlayer ?? g.lastPlayers?.activePlayerName ?? null;
    if (!full) return null;
    const name = full.split('#')[0] ?? full;
    const p = g.lastPlayers?.players.find((x) => x.name === name);
    return { name, team: p?.team ?? 'ORDER' };
  }

  /** Skipped or never-started games: delete the row/folder if no video was recorded. */
  private dropUnrecordedGame(): void {
    const st = this.runner.state;
    const g = this.live;
    if (!g || this.discarding || st === 'LOADING' || st === 'RECORDING' || st === 'RECONNECTING' || st === 'POST_PROCESS') return;
    if (g.segments.length === 0) {
      if (g.rowId !== null) this.store.deleteGame(g.rowId);
      if (g.dir) rmSync(g.dir, { recursive: true, force: true });
    } else if (g.rowId !== null) {
      this.store.updateGame(g.rowId, { status: 'error' });
    }
    this.live = null;
    this.pendingSession = null;
    this.refreshStatus();
  }

  private async discard(reason: string): Promise<void> {
    this.discarding = true;
    const g = this.live;
    console.log(`[lifecycle] discarding game: ${reason}`);
    if (g?.pendingStop) await g.pendingStop.catch(() => undefined);
    if (g?.rowId) this.store.deleteGame(g.rowId);
    if (g?.dir) rmSync(g.dir, { recursive: true, force: true });
    this.live = null;
    this.pendingSession = null;
    this.discarding = false;
    this.refreshStatus();
  }

  // --- status ---------------------------------------------------------------------------------

  private refreshStatus(): void {
    const st = this.runner?.state ?? 'IDLE';
    const enabled = this.settings?.recordingEnabled ?? true;
    const recording = st === 'RECORDING' && this.runner.context.recorderActive && this.runner.context.recordingEnabled;
    const detail: Record<string, string> = {
      IDLE: 'League client not running',
      CLIENT_UP: 'waiting for a game',
      CHAMP_SELECT: 'champ select',
      LOADING: 'loading screen',
      RECORDING: recording ? 'recording' : (this.status.detail ?? 'in game, not recording'),
      RECONNECTING: 'game window lost, waiting for reconnect',
      POST_PROCESS: 'placing events and ranking moments',
    };
    const state: RecorderStatus['state'] = st === 'POST_PROCESS' ? 'post_processing' : recording || st === 'RECONNECTING' ? 'recording' : 'idle';
    const changed = state !== this.status.state;
    this.status = {
      ...this.status,
      state,
      enabled,
      gameId: this.live?.rowId ? String(this.live.rowId) : null,
      sinceIso: changed ? new Date().toISOString() : this.status.sinceIso,
      detail: detail[st] ?? st,
    };
    this.emit();
  }

  private emit(): void {
    for (const cb of this.listeners) cb({ ...this.status });
  }

  getRecorderStatus(): RecorderStatus {
    return { ...this.status };
  }

  onRecorderStatus(cb: (s: RecorderStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    Object.assign(this.recSettings, recordingSettings(s));
    this.runner?.dispatch({ type: 'userPause', paused: !s.recordingEnabled });
    this.refreshStatus();
  }

  mediaRoots(): string[] {
    return this.opts.mediaRoots;
  }

  // --- library --------------------------------------------------------------------------------

  private meOf(rowId: number): Me | null {
    const me = this.store.getTimeline<{ name: string; team: string }>(rowId, 'lvr_me')?.data;
    if (!me) return null;
    const allies = new Set(this.store.listParticipants(rowId).filter((p) => p.team === me.team).map((p) => p.riot_id_name));
    return { name: me.name, allies };
  }

  async listGames(): Promise<Game[]> {
    return this.store
      .listGames({ status: ['recording', 'processing', 'ready', 'error'] })
      .map((row) => mapGame(row, kdaOf(this.store.listEvents(row.id), this.meOf(row.id)), row.size_bytes));
  }

  async getGame(id: string): Promise<GameBundle | null> {
    const detail = this.store.getGame(Number(id));
    if (!detail) return null;
    const me = this.meOf(detail.game.id);
    const events = this.store.listEvents(detail.game.id);
    const byEventId = new Map(events.map((e) => [e.event_id, e.id]));
    const size = detail.segments.reduce((n, s) => n + s.size_bytes, 0);
    return {
      game: mapGame(detail.game, kdaOf(events, me), size),
      segments: detail.segments.map(mapSegment),
      events: events.map((e) => mapEvent(e, me)),
      moments: detail.moments
        .map((m) => mapMoment(m, this.store.getTags(m.id), byEventId, this.settings?.preRollS ?? 10))
        .sort((a, b) => b.score - a.score),
      notes: detail.notes.map(mapNote),
      clips: detail.clips.map(mapClip),
    };
  }

  async saveNote(input: NoteInput): Promise<Note> {
    const text = String(input.text ?? '').slice(0, 4000);
    const momentId = input.momentId ? Number(input.momentId) : null;
    const row = input.id
      ? this.store.updateNote(Number(input.id), { text, video_t_ms: input.videoTMs, moment_id: momentId })
      : this.store.addNote(Number(input.gameId), { text, video_t_ms: Math.max(0, Math.round(input.videoTMs)), moment_id: momentId });
    if (!row) throw new Error(`unknown note ${input.id}`);
    if (momentId !== null && text.trim()) this.store.markMomentReviewed(momentId);
    return mapNote(row);
  }

  async deleteNote(id: string): Promise<void> {
    this.store.deleteNote(Number(id));
  }

  async setTags(momentId: string, tags: CauseTag[]): Promise<void> {
    const clean = [...new Set(tags.filter((t) => (CAUSE_TAGS as readonly string[]).includes(t)))];
    this.store.setTags(Number(momentId), clean);
    if (clean.length) this.store.markMomentReviewed(Number(momentId));
  }

  async markReviewed(momentId: string): Promise<void> {
    this.store.markMomentReviewed(Number(momentId));
  }

  async addClip(clip: Omit<Clip, 'id' | 'createdAt' | 'drawings' | 'description'>): Promise<Clip> {
    const row = this.store.addClip(Number(clip.gameId), {
      segment_id: clip.segmentId ? Number(clip.segmentId) : null,
      t_in_ms: clip.tInMs,
      t_out_ms: clip.tOutMs,
      path: clip.path,
      pinned: clip.pinned,
      title: clip.title || null,
    });
    return mapClip(row);
  }

  async getPlayState(gameId: string, momentId: string): Promise<PlayState | null> {
    const gid = Number(gameId);
    const game = this.store.getGameRow(gid);
    const m = this.store.getMoment(Number(momentId));
    if (!game || !m || m.game_id !== gid) return null;
    const meRow = this.store.getTimeline<{ name: string; team: string }>(gid, 'lvr_me')?.data ?? null;
    const segment = this.store.listSegments(gid)[0];
    const ids = new Set(m.event_ids);
    const events = this.store.listEvents(gid).filter((e) => ids.has(e.event_id));
    const lcu = await this.lcuTimeline(gid, game.game_id);
    const dd = await this.ddragon.forPatch(lcu?.game.gameVersion ?? game.patch);
    const triggerS = m.t_trigger_s;
    return computePlayState({
      momentId,
      triggerS,
      beforeS: Math.max(0, triggerS - (this.settings?.preRollS ?? 10)),
      afterS: triggerS + Math.max(0, (m.t_end_ms ?? 0) - (m.t_trigger_ms ?? 0)) / 1000,
      involved: involvedIn(events),
      kills: killsIn(events.map((e) => ({ name: e.name, payload: e.payload, gameTimeS: e.game_time_s }))),
      me: meRow,
      log: segment ? readPlayersLog(join(dirname(segment.path), 'players.jsonl')) : { snaps: [], gold: [] },
      participants: this.store.listParticipants(gid).map((p) => ({ name: p.riot_id_name, champion: p.champion ?? '', team: p.team === 'CHAOS' ? 'CHAOS' : 'ORDER', role: p.role })),
      lcu,
      dd,
    });
  }

  /** Post-game timeline from the League client, fetched once and kept in the DB. */
  private async lcuTimeline(gid: number, riotGameId: string): Promise<LcuTimeline | null> {
    const cached = this.store.getTimeline<LcuTimeline>(gid, 'lcu_timeline')?.data;
    if (cached) return cached;
    if (!/^\d+$/.test(riotGameId)) return null; // local-… ids: no Riot game id known
    const [tl, game] = await Promise.all([
      this.lcu.get(`/lol-match-history/v1/game-timelines/${riotGameId}`),
      this.lcu.get(`/lol-match-history/v1/games/${riotGameId}`),
    ]);
    if (tl?.status !== 200 || game?.status !== 200) return null;
    try {
      const data: LcuTimeline = { timeline: JSON.parse(tl.body) as LcuTimeline['timeline'], game: JSON.parse(game.body) as LcuTimeline['game'] };
      if (!data.timeline.frames?.length || !Array.isArray(data.game.participants)) return null; // not published yet
      this.store.putTimeline(gid, 'lcu_timeline', data);
      const patch = data.game.gameVersion?.split('.').slice(0, 2).join('.');
      if (patch) this.store.updateGame(gid, { patch });
      return data;
    } catch {
      return null;
    }
  }

  async getClip(id: string): Promise<ClipBundle | null> {
    const row = this.store.getClip(Number(id));
    if (!row) return null;
    const bundle = await this.getGame(String(row.game_id));
    const segment = bundle?.segments.find((s) => s.id === String(row.segment_id)) ?? bundle?.segments[0];
    if (!bundle || !segment) return null;
    return { clip: mapClip(row), game: bundle.game, segment, events: bundle.events };
  }

  async updateClip(id: string, patch: Partial<Pick<Clip, 'title' | 'description' | 'tInMs' | 'tOutMs' | 'path' | 'drawings'>>): Promise<Clip> {
    const row = this.store.updateClip(Number(id), {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.tInMs !== undefined ? { t_in_ms: patch.tInMs } : {}),
      ...(patch.tOutMs !== undefined ? { t_out_ms: patch.tOutMs } : {}),
      ...(patch.path !== undefined ? { path: patch.path } : {}),
      ...(patch.drawings !== undefined ? { drawings: patch.drawings } : {}),
    });
    if (!row) throw new Error(`unknown clip ${id}`);
    return mapClip(row);
  }

  async deleteClip(id: string): Promise<Clip | null> {
    const row = this.store.getClip(Number(id));
    if (!row) return null;
    this.store.deleteClip(row.id);
    return mapClip(row);
  }
}
