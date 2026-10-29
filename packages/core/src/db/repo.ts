/**
 * Repository layer over the PLAN §3.5 schema. One `GameStore` per database; the core is
 * the single writer. All methods are synchronous (`node:sqlite`).
 */
import type { EventRow } from '../events/normalize.js';
import type { Moment, MomentLabel, MomentTheme, ScoreComponents } from '../moments/engine.js';
import type { RetentionGame } from '../retention/retention.js';
import type { SqliteDatabase } from './database.js';

// --- row types ---------------------------------------------------------------------------

export type GameStatus = 'recording' | 'processing' | 'ready' | 'error' | 'discarded';

export interface GameRow {
  id: number;
  game_id: string;
  platform: string | null;
  queue_id: number | null;
  game_mode: string | null;
  patch: string | null;
  started_at: number;
  ended_at: number | null;
  result: string | null;
  my_puuid: string | null;
  my_champion: string | null;
  my_role: string | null;
  duration_s: number | null;
  status: GameStatus;
  pinned: boolean;
  reviewed_at: number | null;
  created_at: number;
}

export interface NewGame {
  game_id: string;
  started_at: number;
  platform?: string | null;
  queue_id?: number | null;
  game_mode?: string | null;
  patch?: string | null;
  my_puuid?: string | null;
  my_champion?: string | null;
  my_role?: string | null;
  status?: GameStatus;
}

export type GameUpdate = Partial<Omit<GameRow, 'id' | 'game_id' | 'created_at'>>;

export interface GameListItem extends GameRow {
  size_bytes: number;
  segment_count: number;
  moment_count: number;
  clip_count: number;
}

export interface SegmentRow {
  id: number;
  game_id: number;
  seq: number;
  path: string;
  qpc_start: number | null;
  wall_start: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  size_bytes: number;
}

export interface NewSegment {
  seq: number;
  path: string;
  qpc_start?: number | bigint | null;
  wall_start?: number | null;
  duration_ms?: number | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  codec?: string | null;
  size_bytes?: number;
}

export interface ParticipantRow {
  game_id: number;
  slot: number;
  riot_id_name: string;
  puuid: string | null;
  team: string;
  champion: string | null;
  role: string | null;
}

export type NewParticipant = Omit<ParticipantRow, 'game_id'>;

export interface StoredEventRow {
  id: number;
  game_id: number;
  event_id: number;
  name: string;
  game_time_s: number;
  video_segment_id: number | null;
  video_t_ms: number | null;
  payload: Record<string, unknown>;
}

export interface MomentRow {
  id: number;
  game_id: number;
  moment_key: string;
  kind: string;
  theme: MomentTheme;
  score: number;
  t_start_s: number;
  t_trigger_s: number;
  t_end_s: number;
  segment_id: number | null;
  t_start_ms: number | null;
  t_trigger_ms: number | null;
  t_end_ms: number | null;
  title: string;
  reasons: string[];
  labels: MomentLabel[];
  components: ScoreComponents;
  event_ids: number[];
  reviewed_at: number | null;
}

export interface NoteRow {
  id: number;
  game_id: number;
  moment_id: number | null;
  video_t_ms: number | null;
  text: string;
  created_at: number;
  updated_at: number | null;
}

export interface ClipRow {
  id: number;
  game_id: number;
  segment_id: number | null;
  t_in_ms: number;
  t_out_ms: number;
  path: string;
  created_at: number;
  pinned: boolean;
  title: string | null;
  description: string | null;
  /** Telestrator drawings, opaque to the core. */
  drawings: unknown[];
}

export interface NewClip {
  segment_id?: number | null;
  t_in_ms: number;
  t_out_ms: number;
  path: string;
  pinned?: boolean;
  title?: string | null;
  description?: string | null;
}

const CLIP_UPDATE_KEYS = new Set(['t_in_ms', 't_out_ms', 'path', 'title', 'description', 'drawings', 'pinned']);

export type ClipUpdate = Partial<Pick<ClipRow, 't_in_ms' | 't_out_ms' | 'path' | 'title' | 'description' | 'drawings' | 'pinned'>>;

export interface GameDetail {
  game: GameRow;
  segments: SegmentRow[];
  participants: ParticipantRow[];
  moments: MomentRow[];
  notes: NoteRow[];
  clips: ClipRow[];
}

export interface ListGamesOptions {
  limit?: number;
  offset?: number;
  status?: GameStatus | GameStatus[];
  pinned?: boolean;
}

/** Cause taxonomy (PLAN §3.5). Free-form tags are allowed too. */
export const CAUSE_TAGS = ['positioning', 'decision', 'skill', 'vision', 'cooldowns', 'map-awareness', 'sacrifice', 'meaningless'] as const;
export type CauseTag = (typeof CAUSE_TAGS)[number];

// --- store ---------------------------------------------------------------------------------

export class GameStore {
  constructor(
    readonly db: SqliteDatabase,
    private readonly now: () => number = () => Date.now(),
  ) {}

  close(): void {
    this.db.close();
  }

  /** Run `fn` inside one transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // --- games

  insertGame(input: NewGame): GameRow {
    const info = this.db
      .prepare(
        `INSERT INTO games (game_id, platform, queue_id, game_mode, patch, started_at, my_puuid, my_champion, my_role, status, created_at)
         VALUES (@game_id, @platform, @queue_id, @game_mode, @patch, @started_at, @my_puuid, @my_champion, @my_role, @status, @created_at)`,
      )
      .run({
        game_id: input.game_id,
        platform: input.platform ?? null,
        queue_id: input.queue_id ?? null,
        game_mode: input.game_mode ?? null,
        patch: input.patch ?? null,
        started_at: input.started_at,
        my_puuid: input.my_puuid ?? null,
        my_champion: input.my_champion ?? null,
        my_role: input.my_role ?? null,
        status: input.status ?? 'recording',
        created_at: this.now(),
      });
    return this.getGameRow(Number(info.lastInsertRowid))!;
  }

  updateGame(id: number, patch: GameUpdate): GameRow | undefined {
    const keys = Object.keys(patch) as Array<keyof GameUpdate>;
    if (keys.length === 0) return this.getGameRow(id);
    const sets = keys.map((k) => `${k} = @${k}`).join(', ');
    const params: Record<string, unknown> = { id };
    for (const k of keys) params[k] = k === 'pinned' ? (patch.pinned ? 1 : 0) : patch[k];
    this.db.prepare(`UPDATE games SET ${sets} WHERE id = @id`).run(params);
    return this.getGameRow(id);
  }

  setGamePinned(id: number, pinned: boolean): void {
    this.db.prepare('UPDATE games SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  }

  getGameRow(id: number): GameRow | undefined {
    const r = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as RawGame | undefined;
    return r ? mapGame(r) : undefined;
  }

  getGameByGameId(gameId: string): GameRow | undefined {
    const r = this.db.prepare('SELECT * FROM games WHERE game_id = ?').get(gameId) as RawGame | undefined;
    return r ? mapGame(r) : undefined;
  }

  getGame(id: number): GameDetail | undefined {
    const game = this.getGameRow(id);
    if (!game) return undefined;
    return {
      game,
      segments: this.listSegments(id),
      participants: this.listParticipants(id),
      moments: this.listMoments(id),
      notes: this.listNotes(id),
      clips: this.listClips(id),
    };
  }

  listGames(options: ListGamesOptions = {}): GameListItem[] {
    const where: string[] = [];
    const params: Record<string, unknown> = { limit: options.limit ?? 100, offset: options.offset ?? 0 };
    if (options.status !== undefined) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      where.push(`g.status IN (${statuses.map((_, i) => `@s${i}`).join(', ')})`);
      statuses.forEach((s, i) => (params[`s${i}`] = s));
    }
    if (options.pinned !== undefined) {
      where.push('g.pinned = @pinned');
      params['pinned'] = options.pinned ? 1 : 0;
    }
    const rows = this.db
      .prepare(
        `SELECT g.*,
                COALESCE((SELECT SUM(size_bytes) FROM segments s WHERE s.game_id = g.id), 0) AS size_bytes,
                (SELECT COUNT(*) FROM segments s WHERE s.game_id = g.id) AS segment_count,
                (SELECT COUNT(*) FROM moments m WHERE m.game_id = g.id) AS moment_count,
                (SELECT COUNT(*) FROM clips c WHERE c.game_id = g.id) AS clip_count
         FROM games g
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY g.started_at DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all(params) as Array<RawGame & { size_bytes: number; segment_count: number; moment_count: number; clip_count: number }>;
    return rows.map((r) => ({ ...mapGame(r), size_bytes: r.size_bytes, segment_count: r.segment_count, moment_count: r.moment_count, clip_count: r.clip_count }));
  }

  /** Cascades to segments, events, moments, notes, tags, clips, timeline cache. Files are the caller's job. */
  deleteGame(id: number): boolean {
    return this.db.prepare('DELETE FROM games WHERE id = ?').run(id).changes > 0;
  }

  /** Input for `planRetention`. */
  retentionCandidates(): RetentionGame[] {
    return this.listGames({ limit: 100_000 }).map((g) => ({
      gameId: String(g.id),
      startedAt: g.started_at,
      pinned: g.pinned,
      sizeBytes: g.size_bytes,
      status: g.status,
    }));
  }

  // --- segments

  addSegment(gameId: number, seg: NewSegment): SegmentRow {
    const info = this.db
      .prepare(
        `INSERT INTO segments (game_id, seq, path, qpc_start, wall_start, duration_ms, width, height, fps, codec, size_bytes)
         VALUES (@game_id, @seq, @path, @qpc_start, @wall_start, @duration_ms, @width, @height, @fps, @codec, @size_bytes)`,
      )
      .run({
        game_id: gameId,
        seq: seg.seq,
        path: seg.path,
        qpc_start: seg.qpc_start === undefined || seg.qpc_start === null ? null : Number(seg.qpc_start),
        wall_start: seg.wall_start ?? null,
        duration_ms: seg.duration_ms ?? null,
        width: seg.width ?? null,
        height: seg.height ?? null,
        fps: seg.fps ?? null,
        codec: seg.codec ?? null,
        size_bytes: seg.size_bytes ?? 0,
      });
    return this.getSegment(Number(info.lastInsertRowid))!;
  }

  updateSegment(id: number, patch: Partial<Omit<NewSegment, 'seq'>>): SegmentRow | undefined {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (keys.length === 0) return this.getSegment(id);
    const params: Record<string, unknown> = { id };
    for (const k of keys) {
      const v = patch[k];
      params[k] = typeof v === 'bigint' ? Number(v) : (v ?? null);
    }
    this.db.prepare(`UPDATE segments SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run(params);
    return this.getSegment(id);
  }

  getSegment(id: number): SegmentRow | undefined {
    return this.db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as SegmentRow | undefined;
  }

  listSegments(gameId: number): SegmentRow[] {
    return this.db.prepare('SELECT * FROM segments WHERE game_id = ? ORDER BY seq').all(gameId) as SegmentRow[];
  }

  // --- participants

  upsertParticipants(gameId: number, participants: readonly NewParticipant[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO participants (game_id, slot, riot_id_name, puuid, team, champion, role)
       VALUES (@game_id, @slot, @riot_id_name, @puuid, @team, @champion, @role)
       ON CONFLICT(game_id, slot) DO UPDATE SET
         riot_id_name = excluded.riot_id_name, puuid = excluded.puuid, team = excluded.team,
         champion = excluded.champion, role = excluded.role`,
    );
    this.transaction(() => {
      for (const p of participants) {
        stmt.run({ game_id: gameId, slot: p.slot, riot_id_name: p.riot_id_name, puuid: p.puuid ?? null, team: p.team, champion: p.champion ?? null, role: p.role ?? null });
      }
    });
  }

  listParticipants(gameId: number): ParticipantRow[] {
    return this.db.prepare('SELECT * FROM participants WHERE game_id = ? ORDER BY slot').all(gameId) as ParticipantRow[];
  }

  // --- events

  /** Insert or update (by `event_id`) normalized events for a game. Returns rows written. */
  bulkInsertEvents(gameId: number, rows: readonly EventRow[]): number {
    const stmt = this.db.prepare(
      `INSERT INTO events (game_id, event_id, name, game_time_s, video_segment_id, video_t_ms, payload_json)
       VALUES (@game_id, @event_id, @name, @game_time_s, @video_segment_id, @video_t_ms, @payload_json)
       ON CONFLICT(game_id, event_id) DO UPDATE SET
         name = excluded.name, game_time_s = excluded.game_time_s, video_segment_id = excluded.video_segment_id,
         video_t_ms = excluded.video_t_ms, payload_json = excluded.payload_json`,
    );
    let n = 0;
    this.transaction(() => {
      for (const r of rows) {
        stmt.run({
          game_id: gameId,
          event_id: r.event_id,
          name: r.name,
          game_time_s: r.game_time_s,
          video_segment_id: r.video_segment_id,
          video_t_ms: r.video_t_ms,
          payload_json: JSON.stringify(r.payload),
        });
        n++;
      }
    });
    return n;
  }

  listEvents(gameId: number): StoredEventRow[] {
    const rows = this.db.prepare('SELECT * FROM events WHERE game_id = ? ORDER BY game_time_s, event_id').all(gameId) as Array<
      Omit<StoredEventRow, 'payload'> & { payload_json: string }
    >;
    return rows.map(({ payload_json, ...rest }) => ({ ...rest, payload: safeJson(payload_json, {}) as Record<string, unknown> }));
  }

  // --- moments

  /** Replace a game's moments with a fresh engine output. Tags/notes on moments whose key survives are kept. */
  replaceMoments(gameId: number, moments: readonly Moment[]): MomentRow[] {
    const keys = moments.map((m) => m.id);
    const upsert = this.db.prepare(
      `INSERT INTO moments (game_id, moment_key, kind, theme, score, t_start_s, t_trigger_s, t_end_s, segment_id,
                            t_start_ms, t_trigger_ms, t_end_ms, title, reason_json, labels_json, score_json, event_ids_json)
       VALUES (@game_id, @moment_key, @kind, @theme, @score, @t_start_s, @t_trigger_s, @t_end_s, @segment_id,
               @t_start_ms, @t_trigger_ms, @t_end_ms, @title, @reason_json, @labels_json, @score_json, @event_ids_json)
       ON CONFLICT(game_id, moment_key) DO UPDATE SET
         kind = excluded.kind, theme = excluded.theme, score = excluded.score,
         t_start_s = excluded.t_start_s, t_trigger_s = excluded.t_trigger_s, t_end_s = excluded.t_end_s,
         segment_id = excluded.segment_id, t_start_ms = excluded.t_start_ms, t_trigger_ms = excluded.t_trigger_ms,
         t_end_ms = excluded.t_end_ms, title = excluded.title, reason_json = excluded.reason_json,
         labels_json = excluded.labels_json, score_json = excluded.score_json, event_ids_json = excluded.event_ids_json`,
    );
    this.transaction(() => {
      if (keys.length === 0) {
        this.db.prepare('DELETE FROM moments WHERE game_id = ?').run(gameId);
      } else {
        this.db
          .prepare(`DELETE FROM moments WHERE game_id = ? AND moment_key NOT IN (${keys.map(() => '?').join(',')})`)
          .run(gameId, ...keys);
      }
      for (const m of moments) {
        upsert.run({
          game_id: gameId,
          moment_key: m.id,
          kind: m.kind,
          theme: m.theme,
          score: m.score,
          t_start_s: m.tStartS,
          t_trigger_s: m.tTriggerS,
          t_end_s: m.tEndS,
          segment_id: m.segmentId,
          t_start_ms: m.tStartMs,
          t_trigger_ms: m.tTriggerMs,
          t_end_ms: m.tEndMs,
          title: m.title,
          reason_json: JSON.stringify(m.reasons),
          labels_json: JSON.stringify(m.labels),
          score_json: JSON.stringify(m.components),
          event_ids_json: JSON.stringify(m.eventIds),
        });
      }
    });
    return this.listMoments(gameId);
  }

  listMoments(gameId: number): MomentRow[] {
    const rows = this.db.prepare('SELECT * FROM moments WHERE game_id = ? ORDER BY score DESC, t_trigger_s').all(gameId) as RawMoment[];
    return rows.map(mapMoment);
  }

  getMoment(id: number): MomentRow | undefined {
    const r = this.db.prepare('SELECT * FROM moments WHERE id = ?').get(id) as RawMoment | undefined;
    return r ? mapMoment(r) : undefined;
  }

  markMomentReviewed(id: number, at: number | null = this.now()): void {
    this.db.prepare('UPDATE moments SET reviewed_at = ? WHERE id = ?').run(at, id);
  }

  // --- notes

  addNote(gameId: number, input: { text: string; moment_id?: number | null; video_t_ms?: number | null }): NoteRow {
    const info = this.db
      .prepare('INSERT INTO notes (game_id, moment_id, video_t_ms, text, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(gameId, input.moment_id ?? null, input.video_t_ms ?? null, input.text, this.now());
    return this.getNote(Number(info.lastInsertRowid))!;
  }

  updateNote(id: number, patch: { text?: string; video_t_ms?: number | null; moment_id?: number | null }): NoteRow | undefined {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (keys.length === 0) return this.getNote(id);
    const params: Record<string, unknown> = { id, updated_at: this.now() };
    for (const k of keys) params[k] = patch[k] ?? null;
    this.db.prepare(`UPDATE notes SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE id = @id`).run(params);
    return this.getNote(id);
  }

  deleteNote(id: number): boolean {
    return this.db.prepare('DELETE FROM notes WHERE id = ?').run(id).changes > 0;
  }

  getNote(id: number): NoteRow | undefined {
    return this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined;
  }

  listNotes(gameId: number, momentId?: number): NoteRow[] {
    if (momentId !== undefined) {
      return this.db.prepare('SELECT * FROM notes WHERE game_id = ? AND moment_id = ? ORDER BY created_at').all(gameId, momentId) as NoteRow[];
    }
    return this.db.prepare('SELECT * FROM notes WHERE game_id = ? ORDER BY created_at').all(gameId) as NoteRow[];
  }

  // --- tags

  setTags(momentId: number, tags: readonly string[]): string[] {
    const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    this.transaction(() => {
      this.db.prepare('DELETE FROM tags WHERE moment_id = ?').run(momentId);
      const ins = this.db.prepare('INSERT INTO tags (moment_id, tag) VALUES (?, ?)');
      for (const t of clean) ins.run(momentId, t);
    });
    return clean;
  }

  addTag(momentId: number, tag: string): void {
    this.db.prepare('INSERT OR IGNORE INTO tags (moment_id, tag) VALUES (?, ?)').run(momentId, tag.trim().toLowerCase());
  }

  removeTag(momentId: number, tag: string): void {
    this.db.prepare('DELETE FROM tags WHERE moment_id = ? AND tag = ?').run(momentId, tag.trim().toLowerCase());
  }

  getTags(momentId: number): string[] {
    return (this.db.prepare('SELECT tag FROM tags WHERE moment_id = ? ORDER BY tag').all(momentId) as Array<{ tag: string }>).map((r) => r.tag);
  }

  /** Tag frequencies across games (trends view), optionally limited to games started after `sinceMs`. */
  listTagCounts(sinceMs?: number): Array<{ tag: string; count: number }> {
    if (sinceMs === undefined) {
      return this.db.prepare('SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag').all() as Array<{ tag: string; count: number }>;
    }
    return this.db
      .prepare(
        `SELECT t.tag, COUNT(*) AS count FROM tags t
         JOIN moments m ON m.id = t.moment_id JOIN games g ON g.id = m.game_id
         WHERE g.started_at >= ? GROUP BY t.tag ORDER BY count DESC, t.tag`,
      )
      .all(sinceMs) as Array<{ tag: string; count: number }>;
  }

  // --- clips

  addClip(gameId: number, clip: NewClip): ClipRow {
    const info = this.db
      .prepare('INSERT INTO clips (game_id, segment_id, t_in_ms, t_out_ms, path, created_at, pinned, title, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(gameId, clip.segment_id ?? null, clip.t_in_ms, clip.t_out_ms, clip.path, this.now(), clip.pinned ? 1 : 0, clip.title ?? null, clip.description ?? null);
    return this.getClip(Number(info.lastInsertRowid))!;
  }

  getClip(id: number): ClipRow | undefined {
    const r = this.db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as RawClip | undefined;
    return r ? mapClip(r) : undefined;
  }

  listClips(gameId?: number): ClipRow[] {
    const rows = (
      gameId === undefined
        ? this.db.prepare('SELECT * FROM clips ORDER BY created_at DESC').all()
        : this.db.prepare('SELECT * FROM clips WHERE game_id = ? ORDER BY created_at DESC').all(gameId)
    ) as RawClip[];
    return rows.map(mapClip);
  }

  updateClip(id: number, patch: ClipUpdate): ClipRow | undefined {
    const cols: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !CLIP_UPDATE_KEYS.has(k)) continue;
      if (k === 'drawings') {
        cols.push('drawings_json = ?');
        params.push(JSON.stringify(v));
      } else if (k === 'pinned') {
        cols.push('pinned = ?');
        params.push(v ? 1 : 0);
      } else {
        cols.push(`${k} = ?`);
        params.push(v);
      }
    }
    if (cols.length) this.db.prepare(`UPDATE clips SET ${cols.join(', ')} WHERE id = ?`).run(...params, id);
    return this.getClip(id);
  }

  setClipPinned(id: number, pinned: boolean): void {
    this.db.prepare('UPDATE clips SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  }

  deleteClip(id: number): boolean {
    return this.db.prepare('DELETE FROM clips WHERE id = ?').run(id).changes > 0;
  }

  // --- timeline cache

  putTimeline(gameId: number, source: string, json: unknown): void {
    this.db
      .prepare(
        `INSERT INTO timeline_cache (game_id, source, fetched_at, json) VALUES (?, ?, ?, ?)
         ON CONFLICT(game_id, source) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json`,
      )
      .run(gameId, source, this.now(), typeof json === 'string' ? json : JSON.stringify(json));
  }

  getTimeline<T = unknown>(gameId: number, source: string): { fetched_at: number; data: T } | undefined {
    const r = this.db.prepare('SELECT fetched_at, json FROM timeline_cache WHERE game_id = ? AND source = ?').get(gameId, source) as
      | { fetched_at: number; json: string }
      | undefined;
    if (!r) return undefined;
    return { fetched_at: r.fetched_at, data: safeJson(r.json, null) as T };
  }

  // --- settings

  getSetting(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  getSettingJson<T>(key: string, fallback: T): T {
    const raw = this.getSetting(key);
    if (raw === undefined) return fallback;
    const parsed = safeJson(raw, undefined);
    return parsed === undefined ? fallback : (parsed as T);
  }

  setSettingJson(key: string, value: unknown): void {
    this.setSetting(key, JSON.stringify(value));
  }

  getAllSettings(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.db.prepare('SELECT key, value FROM settings ORDER BY key').all() as Array<{ key: string; value: string }>) out[r.key] = r.value;
    return out;
  }
}

// --- mapping -------------------------------------------------------------------------------

type RawGame = Omit<GameRow, 'pinned'> & { pinned: number };
type RawClip = Omit<ClipRow, 'pinned' | 'drawings'> & { pinned: number; drawings_json: string };
type RawMoment = Omit<MomentRow, 'reasons' | 'labels' | 'components' | 'event_ids'> & {
  reason_json: string;
  labels_json: string;
  score_json: string;
  event_ids_json: string;
};

function mapGame(r: RawGame): GameRow {
  return { ...r, pinned: r.pinned === 1 };
}

function mapClip(r: RawClip): ClipRow {
  const { drawings_json, ...rest } = r;
  return { ...rest, pinned: r.pinned === 1, drawings: safeJson(drawings_json, []) as unknown[] };
}

function mapMoment(r: RawMoment): MomentRow {
  const { reason_json, labels_json, score_json, event_ids_json, ...rest } = r;
  return {
    ...rest,
    reasons: safeJson(reason_json, []) as string[],
    labels: safeJson(labels_json, []) as MomentLabel[],
    components: safeJson(score_json, {}) as ScoreComponents,
    event_ids: safeJson(event_ids_json, []) as number[],
  };
}

function safeJson(s: string, fallback: unknown): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
