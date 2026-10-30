/**
 * `@lvr/core` rows → the renderer contracts in `../../shared/contracts`.
 * Ids cross the IPC boundary as strings (`String(row.id)`).
 */
import type { ClipRow, GameListItem, GameRow, MomentRow, NoteRow, SegmentRow, StoredEventRow } from '@lvr/core';
import type {
  CauseTag,
  Clip,
  Drawing,
  EventRow,
  Game,
  GameResult,
  GameStatus,
  Lane,
  MarkerKind,
  Moment,
  MomentKind,
  Note,
  Segment,
  Theme,
} from '../../shared/contracts';
import { CAUSE_TAGS, queueName } from '../../shared/contracts';

const OBJECTIVES = new Set(['DragonKill', 'HordeKill', 'HeraldKill', 'BaronKill', 'AtakhanKill']);
const TOWERS = new Set(['TurretKilled', 'InhibKilled']);

const iso = (ms: number | null | undefined): string | null => (ms ? new Date(ms).toISOString() : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function mapResult(r: string | null): GameResult {
  if (r === 'Win') return 'win';
  if (r === 'Lose') return 'loss';
  if (r === 'Neither') return 'remake';
  return 'unknown';
}

function mapStatus(s: GameRow['status']): GameStatus {
  if (s === 'processing') return 'post_processing';
  if (s === 'error' || s === 'discarded') return 'failed';
  return s;
}

/** Who I am in a game, for marker colouring and KDA. */
export interface Me {
  name: string;
  allies: Set<string>;
}

export function kdaOf(events: readonly StoredEventRow[], me: Me | null): [number, number, number] {
  let k = 0;
  let d = 0;
  let a = 0;
  if (!me) return [0, 0, 0];
  for (const e of events) {
    if (e.name !== 'ChampionKill') continue;
    if (str(e.payload['KillerName']) === me.name) k++;
    if (str(e.payload['VictimName']) === me.name) d++;
    if (strArr(e.payload['Assisters']).includes(me.name)) a++;
  }
  return [k, d, a];
}

export function mapGame(row: GameRow | GameListItem, kda: [number, number, number], sizeBytes: number): Game {
  return {
    id: String(row.id),
    gameId: row.game_id,
    platform: row.platform ?? '',
    queueId: row.queue_id ?? -1,
    queueName: row.game_mode === 'PRACTICETOOL' ? 'Practice Tool' : queueName(row.queue_id ?? -1),
    gameMode: row.game_mode ?? '',
    patch: row.patch ?? '',
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: iso(row.ended_at),
    result: mapResult(row.result),
    myPuuid: row.my_puuid ?? '',
    myChampion: row.my_champion ?? '',
    myChampionKey: '',
    myRole: row.my_role ?? '',
    opponent: null,
    iconVersion: null,
    durationS: row.duration_s ?? 0,
    status: mapStatus(row.status),
    kills: kda[0],
    deaths: kda[1],
    assists: kda[2],
    sizeBytes,
    reviewStatus: row.reviewed_at ? 'reviewed' : 'unreviewed',
    pinned: row.pinned,
  };
}

export function mapSegment(s: SegmentRow): Segment {
  return {
    id: String(s.id),
    gameId: String(s.game_id),
    index: s.seq,
    path: s.path,
    qpcStart: s.qpc_start ?? 0,
    wallStart: iso(s.wall_start) ?? '',
    durationMs: s.duration_ms ?? 0,
    width: s.width ?? 0,
    height: s.height ?? 0,
    fps: s.fps ?? 0,
    codec: s.codec ?? '',
    sizeBytes: s.size_bytes,
  };
}

function classify(e: StoredEventRow, me: Me | null): { kind: MarkerKind; lane: Lane } {
  const name = me?.name ?? '\u0000';
  const killer = str(e.payload['KillerName']);
  const victim = str(e.payload['VictimName']);
  const assisters = strArr(e.payload['Assisters']);
  const involved = killer === name || victim === name || assisters.includes(name);
  if (e.name === 'ChampionKill') {
    if (victim === name) return { kind: 'own_death', lane: 'mine' };
    if (killer === name) return { kind: 'own_kill', lane: 'mine' };
    if (assisters.includes(name)) return { kind: 'own_assist', lane: 'mine' };
    return { kind: 'other', lane: 'team' };
  }
  const lane: Lane = involved ? 'mine' : 'team';
  if (OBJECTIVES.has(e.name)) return { kind: 'objective', lane };
  if (TOWERS.has(e.name)) return { kind: 'tower', lane };
  if (e.name === 'Ace') {
    const acer = str(e.payload['Acer']);
    return { kind: 'ace', lane: acer === name || (me?.allies.has(acer) ?? false) ? 'mine' : 'team' };
  }
  return { kind: 'other', lane: 'team' };
}

export function mapEvent(e: StoredEventRow, me: Me | null): EventRow {
  return {
    id: String(e.id),
    gameId: String(e.game_id),
    eventId: e.event_id,
    name: e.name,
    gameTimeS: e.game_time_s,
    videoSegmentId: e.video_segment_id === null ? '' : String(e.video_segment_id),
    videoTMs: e.video_t_ms ?? -1,
    payload: e.payload,
    ...classify(e, me),
  };
}

function momentKind(m: MomentRow): MomentKind {
  switch (m.kind) {
    case 'own_death':
      if (m.labels.includes('gank')) return 'gank_death';
      if (m.labels.includes('teamfight')) return 'teamfight_death';
      return 'solo_death';
    case 'own_kill':
    case 'own_assist':
      return 'kill';
    case 'multikill':
      return 'multikill';
    case 'objective':
      return m.labels.includes('stolen') ? 'objective_steal' : 'objective';
    case 'structure':
      return 'tower';
    case 'ace':
      return 'ace';
    default:
      return 'teamfight_death';
  }
}

/** Derived from the kind (not the stored theme) so games stored before the theme fix read right. */
const THEME_BY_KIND: Record<string, Theme> = {
  own_death: 'deaths',
  own_kill: 'kills',
  own_assist: 'kills',
  multikill: 'kills',
  objective: 'objectives',
  structure: 'objectives',
  ace: 'teamfights',
  team_fight: 'teamfights',
};

/**
 * `eventRowIdByEventId` translates Live Client EventIDs in `event_ids` to event row ids.
 * The jump point is `preRollS` before the trigger, applied at read time so changing the
 * setting also changes games recorded earlier.
 */
export function mapMoment(m: MomentRow, tags: string[], eventRowIdByEventId: Map<number, number>, preRollS: number): Moment {
  const trigger = m.t_trigger_ms ?? 0;
  return {
    id: String(m.id),
    gameId: String(m.game_id),
    kind: momentKind(m),
    score: m.score,
    segmentId: m.segment_id === null ? '' : String(m.segment_id),
    tStartMs: Math.max(0, trigger - preRollS * 1000),
    tTriggerMs: trigger,
    tEndMs: m.t_end_ms ?? 0,
    triggerGameTimeS: m.t_trigger_s,
    title: m.title,
    reasons: m.reasons,
    theme: THEME_BY_KIND[m.kind] ?? 'teamfights',
    mine: m.components.selfInvolvement > 0,
    eventIds: m.event_ids.map((id) => String(eventRowIdByEventId.get(id) ?? id)),
    reviewedAt: iso(m.reviewed_at),
    tags: tags.filter((t): t is CauseTag => (CAUSE_TAGS as readonly string[]).includes(t)),
  };
}

export function mapNote(n: NoteRow): Note {
  return {
    id: String(n.id),
    gameId: String(n.game_id),
    momentId: n.moment_id === null ? null : String(n.moment_id),
    videoTMs: n.video_t_ms ?? 0,
    text: n.text,
    createdAt: new Date(n.created_at).toISOString(),
  };
}

export function mapClip(c: ClipRow): Clip {
  return {
    id: String(c.id),
    gameId: String(c.game_id),
    segmentId: c.segment_id === null ? '' : String(c.segment_id),
    tInMs: c.t_in_ms,
    tOutMs: c.t_out_ms,
    path: c.path,
    createdAt: new Date(c.created_at).toISOString(),
    pinned: c.pinned,
    title: c.title ?? '',
    description: c.description ?? '',
    drawings: (Array.isArray(c.drawings) ? c.drawings : []) as Drawing[],
  };
}
