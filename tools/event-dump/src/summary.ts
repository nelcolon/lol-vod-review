import {
  classifyActor,
  eventActorNames,
  eventStructureId,
  isKnownEvent,
  isRecognisedStructureId,
  parseStructureId,
  type ActorKind,
  type GameStats,
  type ParsedStructureId,
} from '@lvr/schema';
import type { FreshEvent } from './dedupe.js';
import type { AttemptRecord } from './types.js';

export type EndReason = 'game-end' | '2999-gone' | 'sigint' | 'max-seconds' | 'error';

export interface FirstSeen {
  wallMs: number;
  iso: string;
  hrtimeNs: string;
}

export interface Stall {
  gameTime: number;
  startWallMs: number;
  endWallMs: number;
  durationMs: number;
  samples: number;
  /** Still stalled when recording stopped. */
  open?: true;
}

export interface StructureSeen extends ParsedStructureId {
  recognised: boolean;
  count: number;
  eventNames: string[];
}

export interface Summary {
  tool: '@lvr/event-dump';
  startedAt: string;
  endedAt: string;
  durationMs: number;
  endReason: EndReason;
  lcu: {
    enabled: boolean;
    lockfileFound: boolean;
    phases: { phase: string; wallMs: number; iso: string }[];
    sessions: { phase: string; gameId?: number; queueId?: number; gameMode?: string; mapId?: number }[];
  };
  live: {
    firstResponse: (FirstSeen & { endpoint: string; status: number }) | null;
    first200: Record<string, (FirstSeen & { msAfterFirstResponse: number | null }) | undefined>;
    statusCounts: Record<string, Record<string, number>>;
    lastAnswerWallMs: number | null;
  };
  gameStart: { eventId: number; eventTime: number; firstSeen: FirstSeen } | null;
  gameEnd: { result: string; eventTime: number; firstSeen: FirstSeen } | null;
  gamestats: {
    samples: number;
    gameMode?: string;
    mapName?: string;
    mapNumber?: number;
    firstGameTime?: number;
    lastGameTime?: number;
    /** Median of (wall midpoint − gameTime) over advancing samples: wall time of gameTime 0. */
    estimatedGameZeroWallMs?: number;
    estimatedGameZeroIso?: string;
  };
  gameTimeStalls: Stall[];
  gameTimeRegressions: { from: number; to: number; wallMs: number }[];
  events: {
    total: number;
    maxEventId: number | null;
    histogram: Record<string, number>;
    unknownEventNames: Record<string, number>;
    invalidPayloadEvents: { EventID: number; EventName: string }[];
    unparseable: number;
    eventIdConflicts: { EventID: number; EventName: string; previousName: string }[];
    arrayShrinks: number;
  };
  structureIds: StructureSeen[];
  unrecognisedStructureIds: string[];
  actors: {
    playerNames: string[];
    /** Every non-champion actor name, with its classification and the events it appeared in. */
    nonChampion: { name: string; kind: ActorKind; count: number; eventNames: string[]; roles: string[] }[];
  };
  validationFailures: Record<string, number>;
}

const iso = (ms: number) => new Date(ms).toISOString();
const midNs = (a: AttemptRecord) => (BigInt(a.hrtimeNs_start) + BigInt(a.hrtimeNs_end)) / 2n;

/**
 * Pure accumulator for summary.json: fed attempts, parsed payloads and fresh events,
 * it never does I/O, so it is unit-testable with mocked data.
 */
export class Summarizer {
  private readonly phases: Summary['lcu']['phases'] = [];
  private readonly sessions: Summary['lcu']['sessions'] = [];
  private lockfileFound = false;
  private firstResponse: Summary['live']['firstResponse'] = null;
  private readonly first200: Summary['live']['first200'] = {};
  private readonly statusCounts: Summary['live']['statusCounts'] = {};
  private lastAnswerWallMs: number | null = null;
  private gameStart: Summary['gameStart'] = null;
  private gameEnd: Summary['gameEnd'] = null;
  private readonly gs: Summary['gamestats'] = { samples: 0 };
  private readonly zeroOffsets: number[] = [];
  private prevGs: { gameTime: number; wallMs: number; midNs: bigint } | null = null;
  private stall: { gameTime: number; startWallMs: number; startNs: bigint; endWallMs: number; endNs: bigint; samples: number } | null = null;
  private readonly stalls: Stall[] = [];
  private readonly regressions: Summary['gameTimeRegressions'] = [];
  private total = 0;
  private maxEventId: number | null = null;
  private readonly histogram: Record<string, number> = {};
  private readonly unknownNames: Record<string, number> = {};
  private readonly invalidPayload: Summary['events']['invalidPayloadEvents'] = [];
  private unparseable = 0;
  private readonly conflicts: Summary['events']['eventIdConflicts'] = [];
  private arrayShrinks = 0;
  private readonly structures = new Map<string, { count: number; names: Set<string> }>();
  private readonly actors = new Map<string, { count: number; names: Set<string>; roles: Set<string> }>();
  private readonly playerNames = new Set<string>();
  private readonly validation: Record<string, number> = {};

  constructor(
    private readonly startWallMs: number,
    private readonly lcuEnabled: boolean,
    /** Minimum wall duration for a gameTime plateau to count as a stall. */
    private readonly minStallMs = 1000,
  ) {}

  get gameEndSeen(): boolean {
    return this.gameEnd !== null;
  }

  onLockfile(found: boolean): void {
    if (found) this.lockfileFound = true;
  }

  onPhase(phase: string, wallMs: number): void {
    this.phases.push({ phase, wallMs, iso: iso(wallMs) });
  }

  onSession(s: Summary['lcu']['sessions'][number]): void {
    this.sessions.push(s);
  }

  /** Every 2999 attempt, success or not. */
  onLiveAttempt(a: AttemptRecord): void {
    const key = a.status === null ? (a.error?.code ?? 'ERROR') : String(a.status);
    const bucket = (this.statusCounts[a.endpoint] ??= {});
    bucket[key] = (bucket[key] ?? 0) + 1;
    if (a.status === null) return;
    this.lastAnswerWallMs = a.wallMs;
    if (!this.firstResponse || a.wallMs < this.firstResponse.wallMs) {
      this.firstResponse = { endpoint: a.endpoint, status: a.status, wallMs: a.wallMs, iso: iso(a.wallMs), hrtimeNs: a.hrtimeNs_start };
    }
    if (a.status === 200 && !this.first200[a.endpoint]) {
      this.first200[a.endpoint] = {
        wallMs: a.wallMs,
        iso: iso(a.wallMs),
        hrtimeNs: a.hrtimeNs_start,
        msAfterFirstResponse: this.firstResponse ? Math.max(0, a.wallMs - this.firstResponse.wallMs) : null,
      };
    }
  }

  onValidationFailure(endpoint: string): void {
    this.validation[endpoint] = (this.validation[endpoint] ?? 0) + 1;
  }

  onGameStats(stats: GameStats, a: AttemptRecord): void {
    const mid = midNs(a);
    const wallMid = a.wallMs + Number(BigInt(a.hrtimeNs_end) - BigInt(a.hrtimeNs_start)) / 2e6;
    this.gs.samples++;
    this.gs.gameMode = stats.gameMode;
    this.gs.mapName = stats.mapName;
    this.gs.mapNumber = stats.mapNumber;
    this.gs.firstGameTime ??= stats.gameTime;
    this.gs.lastGameTime = stats.gameTime;

    const prev = this.prevGs;
    if (prev) {
      if (Math.abs(stats.gameTime - prev.gameTime) < 1e-9) {
        if (this.stall) {
          this.stall.endWallMs = wallMid;
          this.stall.endNs = mid;
          this.stall.samples++;
        } else {
          this.stall = { gameTime: prev.gameTime, startWallMs: prev.wallMs, startNs: prev.midNs, endWallMs: wallMid, endNs: mid, samples: 2 };
        }
      } else {
        this.closeStall(false);
        if (stats.gameTime < prev.gameTime) this.regressions.push({ from: prev.gameTime, to: stats.gameTime, wallMs: a.wallMs });
        else if (stats.gameTime > 0) this.zeroOffsets.push(wallMid - stats.gameTime * 1000);
      }
    }
    this.prevGs = { gameTime: stats.gameTime, wallMs: wallMid, midNs: mid };
  }

  private closeStall(open: boolean): void {
    const s = this.stall;
    this.stall = null;
    if (!s) return;
    const durationMs = Number(s.endNs - s.startNs) / 1e6;
    if (durationMs < this.minStallMs) return;
    const stall: Stall = { gameTime: s.gameTime, startWallMs: s.startWallMs, endWallMs: s.endWallMs, durationMs, samples: s.samples };
    if (open) stall.open = true;
    this.stalls.push(stall);
  }

  onEventArray(shrunk: boolean): void {
    if (shrunk) this.arrayShrinks++;
  }

  onPlayerNames(names: Iterable<string>): void {
    for (const n of names) this.playerNames.add(n);
  }

  onFreshEvents(fresh: readonly FreshEvent[], a: AttemptRecord): void {
    const seen: FirstSeen = { wallMs: a.wallMs, iso: iso(a.wallMs), hrtimeNs: a.hrtimeNs_start };
    for (const f of fresh) {
      const e = f.parsed;
      if (!e) {
        this.unparseable++;
        continue;
      }
      this.total++;
      if (Number.isFinite(e.EventID)) this.maxEventId = Math.max(this.maxEventId ?? e.EventID, e.EventID);
      this.histogram[e.EventName] = (this.histogram[e.EventName] ?? 0) + 1;
      if (f.idConflict) this.conflicts.push({ EventID: e.EventID, EventName: e.EventName, previousName: f.idConflict.previousName });
      if (!isKnownEvent(e)) {
        if (e.reason === 'unknown-name') this.unknownNames[e.EventName] = (this.unknownNames[e.EventName] ?? 0) + 1;
        else this.invalidPayload.push({ EventID: e.EventID, EventName: e.EventName });
      } else if (e.EventName === 'GameStart' && !this.gameStart) {
        this.gameStart = { eventId: e.EventID, eventTime: e.EventTime, firstSeen: seen };
      } else if (e.EventName === 'GameEnd' && !this.gameEnd) {
        this.gameEnd = { result: e.Result, eventTime: e.EventTime, firstSeen: seen };
      }

      const sid = eventStructureId(e);
      if (sid) {
        const s = this.structures.get(sid) ?? { count: 0, names: new Set<string>() };
        s.count++;
        s.names.add(e.EventName);
        this.structures.set(sid, s);
      }
      const src = isKnownEvent(e) ? (e as Record<string, unknown>) : e.raw;
      const roleOf = (name: string): string => {
        for (const k of ['KillerName', 'VictimName', 'Recipient', 'Acer']) if (src[k] === name) return k;
        return 'Assister';
      };
      for (const name of eventActorNames(e)) {
        const r = this.actors.get(name) ?? { count: 0, names: new Set<string>(), roles: new Set<string>() };
        r.count++;
        r.names.add(e.EventName);
        r.roles.add(roleOf(name));
        this.actors.set(name, r);
      }
    }
  }

  finalize(endReason: EndReason, endWallMs: number): Summary {
    if (this.stall) this.closeStall(true);
    const structureIds: StructureSeen[] = [...this.structures.entries()]
      .map(([id, s]) => {
        const p = parseStructureId(id);
        return { ...p, recognised: isRecognisedStructureId(p), count: s.count, eventNames: [...s.names].sort() };
      })
      .sort((a, b) => a.raw.localeCompare(b.raw));
    const players = [...this.playerNames];
    const nonChampion = [...this.actors.entries()]
      .map(([name, r]) => ({ name, kind: classifyActor(name, players), count: r.count, eventNames: [...r.names].sort(), roles: [...r.roles].sort() }))
      .filter((a) => a.kind !== 'champion')
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const gamestats = { ...this.gs };
    const z = median(this.zeroOffsets);
    if (z !== undefined) {
      gamestats.estimatedGameZeroWallMs = Math.round(z);
      gamestats.estimatedGameZeroIso = iso(z);
    }
    return {
      tool: '@lvr/event-dump',
      startedAt: iso(this.startWallMs),
      endedAt: iso(endWallMs),
      durationMs: endWallMs - this.startWallMs,
      endReason,
      lcu: { enabled: this.lcuEnabled, lockfileFound: this.lockfileFound, phases: this.phases, sessions: this.sessions },
      live: {
        firstResponse: this.firstResponse,
        first200: this.first200,
        statusCounts: this.statusCounts,
        lastAnswerWallMs: this.lastAnswerWallMs,
      },
      gameStart: this.gameStart,
      gameEnd: this.gameEnd,
      gamestats,
      gameTimeStalls: this.stalls,
      gameTimeRegressions: this.regressions,
      events: {
        total: this.total,
        maxEventId: this.maxEventId,
        histogram: this.histogram,
        unknownEventNames: this.unknownNames,
        invalidPayloadEvents: this.invalidPayload,
        unparseable: this.unparseable,
        eventIdConflicts: this.conflicts,
        arrayShrinks: this.arrayShrinks,
      },
      structureIds,
      unrecognisedStructureIds: structureIds.filter((s) => !s.recognised).map((s) => s.raw),
      actors: { playerNames: players.sort(), nonChampion },
      validationFailures: this.validation,
    };
  }
}

function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Human-readable summary for the console. */
export function formatSummary(s: Summary, outDir?: string): string {
  const L: string[] = [];
  L.push('=== event-dump summary ===');
  if (outDir) L.push(`folder:        ${outDir}`);
  L.push(`duration:      ${fmtSec(s.durationMs)}  (end: ${s.endReason})`);
  if (s.lcu.enabled) {
    L.push(`LCU lockfile:  ${s.lcu.lockfileFound ? 'found' : 'NOT found'}`);
    L.push(`phases:        ${s.lcu.phases.map((p) => p.phase).join(' -> ') || '(none)'}`);
    for (const ss of s.lcu.sessions) L.push(`session:       ${ss.phase} gameId=${ss.gameId ?? '?'} queue=${ss.queueId ?? '?'} mode=${ss.gameMode ?? '?'} map=${ss.mapId ?? '?'}`);
  } else {
    L.push('LCU:           disabled (--no-lcu)');
  }
  const fr = s.live.firstResponse;
  L.push(`2999 first:    ${fr ? `${fr.endpoint} HTTP ${fr.status} at ${fr.iso}` : 'never answered'}`);
  for (const [ep, f] of Object.entries(s.live.first200)) {
    if (f) L.push(`  first 200 ${ep.padEnd(16)} ${f.iso}${f.msAfterFirstResponse ? ` (+${fmtSec(f.msAfterFirstResponse)} after first response)` : ''}`);
  }
  for (const [ep, counts] of Object.entries(s.live.statusCounts)) {
    L.push(`  ${ep.padEnd(16)} ${Object.entries(counts).map(([k, v]) => `${k}x${v}`).join(' ')}`);
  }
  if (s.gameStart) L.push(`GameStart:     EventTime ${s.gameStart.eventTime.toFixed(3)} first seen ${s.gameStart.firstSeen.iso}`);
  if (s.gameEnd) L.push(`GameEnd:       ${s.gameEnd.result} at ${s.gameEnd.eventTime.toFixed(1)} s`);
  if (s.gamestats.samples) {
    L.push(
      `gamestats:     ${s.gamestats.samples} samples, ${s.gamestats.gameMode} ${s.gamestats.mapName}, gameTime ${s.gamestats.firstGameTime?.toFixed(1)} -> ${s.gamestats.lastGameTime?.toFixed(1)}`,
    );
    if (s.gamestats.estimatedGameZeroIso) L.push(`  gameTime 0 ~ ${s.gamestats.estimatedGameZeroIso}`);
  }
  if (s.gameTimeStalls.length) {
    L.push(`stalls:        ${s.gameTimeStalls.map((st) => `${st.gameTime.toFixed(1)}s for ${fmtSec(st.durationMs)}${st.open ? ' (open)' : ''}`).join(', ')}`);
  }
  if (s.gameTimeRegressions.length) L.push(`regressions:   ${s.gameTimeRegressions.length}`);
  L.push(`events:        ${s.events.total} (max EventID ${s.events.maxEventId ?? '-'})`);
  const hist = Object.entries(s.events.histogram).sort((a, b) => b[1] - a[1]);
  if (hist.length) L.push(`  ${hist.map(([k, v]) => `${k}:${v}`).join('  ')}`);
  const unk = Object.keys(s.events.unknownEventNames);
  if (unk.length) L.push(`UNKNOWN events: ${unk.join(', ')}`);
  if (s.events.invalidPayloadEvents.length) L.push(`invalid payloads: ${s.events.invalidPayloadEvents.map((e) => `${e.EventName}#${e.EventID}`).join(', ')}`);
  if (s.events.eventIdConflicts.length) L.push(`EventID conflicts: ${s.events.eventIdConflicts.length}`);
  if (s.events.arrayShrinks) L.push(`event array shrank ${s.events.arrayShrinks}x`);
  if (s.structureIds.length) {
    L.push(`structures:    ${s.structureIds.length} distinct`);
    for (const st of s.structureIds) {
      L.push(`  ${st.raw.padEnd(34)} ${st.kind} ${st.team ?? '?'} ${st.laneToken ?? '?'}${st.laneGuess ? `(${st.laneGuess}${st.laneGuessConfirmed ? '' : '?'})` : ''} ${st.position ?? ''} [${st.eventNames.join(',')}]`);
    }
  }
  if (s.unrecognisedStructureIds.length) L.push(`UNRECOGNISED structure IDs: ${s.unrecognisedStructureIds.join(', ')}`);
  if (s.actors.nonChampion.length) {
    L.push('non-champion actors:');
    for (const a of s.actors.nonChampion) L.push(`  ${a.name} (${a.kind}) x${a.count} as ${a.roles.join('/')} in ${a.eventNames.join(',')}`);
  }
  const vf = Object.entries(s.validationFailures);
  if (vf.length) L.push(`schema validation failures: ${vf.map(([k, v]) => `${k}:${v}`).join(' ')}`);
  return L.join('\n');
}
