/**
 * Normalizer: raw Live Client events → `EventRow`s (PLAN §3.5 `events` table).
 *
 * - `FirstBlood` is folded into its `ChampionKill` twin (same `EventTime`) as
 *   `payload.firstBlood = true`; `FirstBrick` into its `TurretKilled` twin as
 *   `payload.firstBrick = true`. They never become separate rows/moments.
 * - `video_segment_id` / `video_t_ms` come from the clock mapper + segment list; both are
 *   null when the event cannot be placed on video (no fit yet, or it fell in a gap).
 */

import type { LiveEvent, Team } from '../types.js';

export interface EventRow {
  game_id: string;
  event_id: number;
  name: string;
  game_time_s: number;
  video_segment_id: number | null;
  video_t_ms: number | null;
  payload: Record<string, unknown>;
}

export interface SegmentRef {
  id: number;
  /** Host ns of the first frame (`qpcStart` reported by the recorder). */
  startNs: number | bigint;
  /** Host ns when the segment stopped; undefined/null while recording. */
  endNs?: number | bigint | null;
}

export interface ClockLike {
  toHostNs(gameTimeS: number): number | undefined;
}

export interface NormalizeOptions {
  gameId: string;
  clock?: ClockLike;
  segments?: SegmentRef[];
  /** Max |ΔEventTime| for twin folding. Default 0.05 s. */
  twinToleranceS?: number;
}

/** Normalize a batch of raw events (any order, duplicates by EventID removed). */
export function normalizeEvents(events: readonly LiveEvent[], options: NormalizeOptions): EventRow[] {
  const tol = options.twinToleranceS ?? 0.05;
  const byId = new Map<number, LiveEvent>();
  for (const e of events) if (!byId.has(e.EventID)) byId.set(e.EventID, e);
  const sorted = [...byId.values()].sort((a, b) => a.EventTime - b.EventTime || a.EventID - b.EventID);

  const firstBloods = sorted.filter((e) => e.EventName === 'FirstBlood');
  const firstBricks = sorted.filter((e) => e.EventName === 'FirstBrick');
  const folded = new Set<number>();

  const rows: EventRow[] = [];
  for (const e of sorted) {
    if (e.EventName === 'FirstBlood' || e.EventName === 'FirstBrick') continue; // emitted as flags below
    const payload = payloadOf(e);

    if (e.EventName === 'ChampionKill') {
      const twin = firstBloods.find((fb) => !folded.has(fb.EventID) && Math.abs(fb.EventTime - e.EventTime) <= tol);
      if (twin) {
        folded.add(twin.EventID);
        payload['firstBlood'] = true;
        payload['firstBloodEventId'] = twin.EventID;
      }
    } else if (e.EventName === 'TurretKilled') {
      const twin = firstBricks.find((fb) => !folded.has(fb.EventID) && Math.abs(fb.EventTime - e.EventTime) <= tol);
      if (twin) {
        folded.add(twin.EventID);
        payload['firstBrick'] = true;
        payload['firstBrickEventId'] = twin.EventID;
      }
    }

    const placed = placeOnVideo(e.EventTime, options);
    rows.push({
      game_id: options.gameId,
      event_id: e.EventID,
      name: e.EventName,
      game_time_s: e.EventTime,
      video_segment_id: placed?.segmentId ?? null,
      video_t_ms: placed?.videoMs ?? null,
      payload,
    });
  }

  // Orphan FirstBlood/FirstBrick (twin missing from this batch): keep as their own rows so
  // nothing is lost; the moments engine ignores them.
  for (const e of [...firstBloods, ...firstBricks]) {
    if (folded.has(e.EventID)) continue;
    const placed = placeOnVideo(e.EventTime, options);
    rows.push({
      game_id: options.gameId,
      event_id: e.EventID,
      name: e.EventName,
      game_time_s: e.EventTime,
      video_segment_id: placed?.segmentId ?? null,
      video_t_ms: placed?.videoMs ?? null,
      payload: { ...payloadOf(e), orphanTwin: true },
    });
  }

  rows.sort((a, b) => a.game_time_s - b.game_time_s || a.event_id - b.event_id);
  return rows;
}

/** Map a game time onto (segment, ms) using the clock and the segment list. */
export function placeOnVideo(gameTimeS: number, options: Pick<NormalizeOptions, 'clock' | 'segments'>): { segmentId: number; videoMs: number } | undefined {
  if (!options.clock || !options.segments || options.segments.length === 0) return undefined;
  const host = options.clock.toHostNs(gameTimeS);
  if (host === undefined) return undefined;
  for (const seg of options.segments) {
    const start = Number(seg.startNs);
    const end = seg.endNs === undefined || seg.endNs === null ? Number.POSITIVE_INFINITY : Number(seg.endNs);
    if (host >= start && host <= end) return { segmentId: seg.id, videoMs: (host - start) / 1e6 };
  }
  return undefined;
}

function payloadOf(e: LiveEvent): Record<string, unknown> {
  const { EventID: _id, EventTime: _t, EventName: _n, ...rest } = e as Record<string, unknown>;
  return { ...rest };
}

// --- structure IDs -----------------------------------------------------------------------
// TODO(schema): replace with `@lvr/schema`'s structure-ID parser.

/**
 * Team that *owns* a structure, from any of the three ID generations:
 *   `Turret_T2_L_03_A` / `Barracks_T2_R1`   (≤2024: T1 = ORDER, T2 = CHAOS)
 *   `Turret_T100_L2_P3_…` / `Inhib_T200_L1_P1_…` (T100 = ORDER, T200 = CHAOS)
 *   `Turret_TOrder_…` / `Turret_TChaos_…`
 */
export function structureTeam(id: string | undefined | null): Team | undefined {
  if (!id) return undefined;
  const m = /_T(Order|Chaos|100|200|1|2)(?:_|$)/i.exec(id);
  if (!m) return undefined;
  const tok = m[1]!.toLowerCase();
  if (tok === 'order' || tok === '100' || tok === '1') return 'ORDER';
  if (tok === 'chaos' || tok === '200' || tok === '2') return 'CHAOS';
  return undefined;
}

export function otherTeam(team: Team): Team {
  return team === 'ORDER' ? 'CHAOS' : 'ORDER';
}
