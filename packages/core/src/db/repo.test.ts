import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EventRow } from '../events/normalize.js';
import type { Moment } from '../moments/engine.js';
import { planRetention } from '../retention/retention.js';
import { currentSchemaVersion, migrate, openDatabase } from './database.js';
import { SCHEMA_VERSION } from './migrations/index.js';
import { GameStore } from './repo.js';

let now = 1_700_000_000_000;
const stores: GameStore[] = [];
const dirs: string[] = [];

function memStore(): GameStore {
  const s = new GameStore(openDatabase(':memory:'), () => now);
  stores.push(s);
  return s;
}

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function moment(id: string, score: number, t: number, over: Partial<Moment> = {}): Moment {
  return {
    id,
    kind: 'own_death',
    theme: 'deaths',
    title: `Solo death, ${t}`,
    score,
    components: { selfInvolvement: 1, stakes: 0.2, participants: 0.2, phase: 1, deathCost: 0.3 },
    labels: ['solo'],
    reasons: ['You died'],
    tStartS: t - 45,
    tTriggerS: t,
    tEndS: t + 10,
    segmentId: null,
    tStartMs: null,
    tTriggerMs: null,
    tEndMs: null,
    triggerEventId: 1,
    eventIds: [1],
    ...over,
  };
}

describe('database', () => {
  it('migrates an empty database to the current schema, idempotently', () => {
    const db = openDatabase(':memory:', { migrate: false });
    expect(currentSchemaVersion(db)).toBe(0);
    const r = migrate(db);
    expect(r).toMatchObject({ from: 0, to: SCHEMA_VERSION });
    expect(r.applied.map((a) => a.name)).toEqual(['init', 'clip_details']);
    expect(migrate(db).applied).toEqual([]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['games', 'segments', 'participants', 'events', 'moments', 'notes', 'tags', 'clips', 'timeline_cache', 'settings']));
    db.close();
  });

  it('opens a file database in WAL mode with foreign keys on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lvr-core-'));
    dirs.push(dir);
    const db = openDatabase(join(dir, 'lvr.sqlite'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(currentSchemaVersion(db)).toBe(SCHEMA_VERSION);
    db.close();
  });
});

describe('GameStore', () => {
  it('inserts, updates, pins and lists games with aggregates', () => {
    const s = memStore();
    const g1 = s.insertGame({ game_id: 'NA1_1', started_at: 1000, queue_id: 420, game_mode: 'CLASSIC', my_champion: 'Ahri' });
    const g2 = s.insertGame({ game_id: 'NA1_2', started_at: 2000, status: 'ready' });
    expect(g1).toMatchObject({ id: 1, game_id: 'NA1_1', status: 'recording', pinned: false, created_at: now });
    expect(s.getGameByGameId('NA1_2')?.id).toBe(g2.id);
    expect(() => s.insertGame({ game_id: 'NA1_1', started_at: 1 })).toThrow();

    s.updateGame(g1.id, { status: 'ready', result: 'Win', duration_s: 1800.5, ended_at: 1_900_000, pinned: true });
    expect(s.getGameRow(g1.id)).toMatchObject({ status: 'ready', result: 'Win', duration_s: 1800.5, pinned: true });
    s.setGamePinned(g1.id, false);
    expect(s.getGameRow(g1.id)!.pinned).toBe(false);

    s.addSegment(g1.id, { seq: 0, path: 'a.mp4', size_bytes: 1000, qpc_start: 123n });
    s.addSegment(g1.id, { seq: 1, path: 'b.mp4', size_bytes: 500 });
    s.addClip(g1.id, { t_in_ms: 0, t_out_ms: 1000, path: 'c.mp4' });

    const list = s.listGames();
    expect(list.map((g) => g.game_id)).toEqual(['NA1_2', 'NA1_1']); // newest first
    expect(list[1]).toMatchObject({ size_bytes: 1500, segment_count: 2, clip_count: 1, moment_count: 0 });
    expect(s.listGames({ status: 'ready', limit: 10 })).toHaveLength(2);
    expect(s.listGames({ pinned: true })).toHaveLength(0);
    expect(s.listGames({ status: ['recording', 'processing'] })).toHaveLength(0);
  });

  it('stores segments and participants', () => {
    const s = memStore();
    const g = s.insertGame({ game_id: 'g', started_at: 1 });
    const seg = s.addSegment(g.id, { seq: 0, path: 'seg-01.mp4', qpc_start: 5_000_000_000_000n, wall_start: 1_700_000_000_000, width: 1920, height: 1080, fps: 60, codec: 'h264' });
    expect(seg).toMatchObject({ game_id: g.id, seq: 0, qpc_start: 5_000_000_000_000, size_bytes: 0 });
    s.updateSegment(seg.id, { duration_ms: 1234, size_bytes: 99 });
    expect(s.getSegment(seg.id)).toMatchObject({ duration_ms: 1234, size_bytes: 99 });
    expect(() => s.addSegment(g.id, { seq: 0, path: 'dup.mp4' })).toThrow();

    s.upsertParticipants(g.id, [
      { slot: 0, riot_id_name: 'Me', puuid: 'p0', team: 'ORDER', champion: 'Ahri', role: 'MIDDLE' },
      { slot: 5, riot_id_name: 'E1', puuid: null, team: 'CHAOS', champion: 'Zed', role: null },
    ]);
    s.upsertParticipants(g.id, [{ slot: 5, riot_id_name: 'E1', puuid: 'p5', team: 'CHAOS', champion: 'Zed', role: 'MIDDLE' }]);
    const ps = s.listParticipants(g.id);
    expect(ps).toHaveLength(2);
    expect(ps[1]).toMatchObject({ slot: 5, puuid: 'p5', role: 'MIDDLE' });
  });

  it('bulk inserts events idempotently and round-trips payloads', () => {
    const s = memStore();
    const g = s.insertGame({ game_id: 'g', started_at: 1 });
    const seg = s.addSegment(g.id, { seq: 0, path: 'x.mp4' });
    const rows: EventRow[] = [
      { game_id: 'g', event_id: 0, name: 'GameStart', game_time_s: 0, video_segment_id: null, video_t_ms: null, payload: {} },
      { game_id: 'g', event_id: 3, name: 'ChampionKill', game_time_s: 190.2, video_segment_id: seg.id, video_t_ms: 192_200, payload: { KillerName: 'A', VictimName: 'B', Assisters: [], firstBlood: true } },
    ];
    expect(s.bulkInsertEvents(g.id, rows)).toBe(2);
    rows[1]!.video_t_ms = 192_300; // re-processed with a better clock fit
    expect(s.bulkInsertEvents(g.id, rows)).toBe(2);
    const stored = s.listEvents(g.id);
    expect(stored).toHaveLength(2);
    expect(stored[1]).toMatchObject({ event_id: 3, name: 'ChampionKill', video_segment_id: seg.id, video_t_ms: 192_300, payload: { firstBlood: true, Assisters: [] } });
  });

  it('replaces moments while keeping tags and notes of surviving keys', () => {
    const s = memStore();
    const g = s.insertGame({ game_id: 'g', started_at: 1 });
    const first = s.replaceMoments(g.id, [moment('own_death:2', 0.9, 190), moment('own_death:8', 0.7, 702), moment('objective:18', 0.5, 1260, { kind: 'objective', theme: 'objectives', labels: ['stolen'] })]);
    expect(first.map((m) => m.moment_key)).toEqual(['own_death:2', 'own_death:8', 'objective:18']);
    expect(first[2]).toMatchObject({ labels: ['stolen'], components: { selfInvolvement: 1 }, event_ids: [1], reasons: ['You died'] });

    const keep = first[0]!;
    s.setTags(keep.id, ['Positioning', 'vision', 'positioning ']);
    expect(s.getTags(keep.id)).toEqual(['positioning', 'vision']);
    s.addTag(keep.id, 'decision');
    s.removeTag(keep.id, 'vision');
    const note = s.addNote(g.id, { text: 'walked into fog', moment_id: keep.id, video_t_ms: 190_000 });
    const gone = first[1]!;
    s.setTags(gone.id, ['skill']);

    const second = s.replaceMoments(g.id, [moment('own_death:2', 0.95, 190), moment('structure:9', 0.4, 780, { kind: 'structure', theme: 'objectives' })]);
    expect(second.map((m) => m.moment_key)).toEqual(['own_death:2', 'structure:9']);
    expect(second[0]!.id).toBe(keep.id);
    expect(second[0]!.score).toBe(0.95);
    expect(s.getTags(keep.id)).toEqual(['decision', 'positioning']);
    expect(s.getTags(gone.id)).toEqual([]);
    expect(s.listNotes(g.id, keep.id)).toHaveLength(1);
    expect(s.listTagCounts()).toEqual([
      { tag: 'decision', count: 1 },
      { tag: 'positioning', count: 1 },
    ]);
    expect(s.listTagCounts(2)).toEqual([]);

    s.markMomentReviewed(keep.id);
    expect(s.getMoment(keep.id)!.reviewed_at).toBe(now);
    expect(s.replaceMoments(g.id, [])).toEqual([]);
    // the note survives with moment_id cleared
    expect(s.getNote(note.id)).toMatchObject({ moment_id: null, text: 'walked into fog' });
  });

  it('notes CRUD', () => {
    const s = memStore();
    const g = s.insertGame({ game_id: 'g', started_at: 1 });
    const n = s.addNote(g.id, { text: 'a', video_t_ms: 10 });
    expect(n).toMatchObject({ text: 'a', video_t_ms: 10, moment_id: null, created_at: now, updated_at: null });
    now += 5;
    expect(s.updateNote(n.id, { text: 'b' })).toMatchObject({ text: 'b', updated_at: now });
    expect(s.listNotes(g.id)).toHaveLength(1);
    expect(s.deleteNote(n.id)).toBe(true);
    expect(s.deleteNote(n.id)).toBe(false);
    expect(s.listNotes(g.id)).toEqual([]);
  });

  it('clips CRUD', () => {
    const s = memStore();
    const g = s.insertGame({ game_id: 'g', started_at: 1 });
    const seg = s.addSegment(g.id, { seq: 0, path: 'x.mp4' });
    const c = s.addClip(g.id, { segment_id: seg.id, t_in_ms: 1000, t_out_ms: 61_000, path: 'clips/1.mp4' });
    expect(c).toMatchObject({ segment_id: seg.id, pinned: false });
    s.setClipPinned(c.id, true);
    expect(s.getClip(c.id)!.pinned).toBe(true);
    expect(s.listClips()).toHaveLength(1);
    expect(s.listClips(g.id)).toHaveLength(1);
    expect(c).toMatchObject({ title: null, description: null, drawings: [] });
    const u = s.updateClip(c.id, { title: 'Bad flash', description: 'too early', t_in_ms: 500, drawings: [{ t: 2000, shapes: [] }] });
    expect(u).toMatchObject({ title: 'Bad flash', description: 'too early', t_in_ms: 500, t_out_ms: 61_000, drawings: [{ t: 2000, shapes: [] }] });
    expect(s.deleteClip(c.id)).toBe(true);
    expect(s.listClips(g.id)).toEqual([]);
  });

  it('timeline cache and settings', () => {
    const s = memStore();
    const g = s.insertGame({ game_id: 'g', started_at: 1 });
    expect(s.getTimeline(g.id, 'lcu')).toBeUndefined();
    s.putTimeline(g.id, 'lcu', { frames: [1, 2] });
    now += 1;
    s.putTimeline(g.id, 'lcu', { frames: [1, 2, 3] });
    expect(s.getTimeline<{ frames: number[] }>(g.id, 'lcu')).toEqual({ fetched_at: now, data: { frames: [1, 2, 3] } });

    expect(s.getSetting('quotaGb')).toBeUndefined();
    s.setSetting('quotaGb', '50');
    s.setSetting('quotaGb', '60');
    expect(s.getSetting('quotaGb')).toBe('60');
    s.setSettingJson('queues', { aram: false });
    expect(s.getSettingJson('queues', { aram: true })).toEqual({ aram: false });
    expect(s.getSettingJson('missing', 7)).toBe(7);
    expect(s.getAllSettings()).toEqual({ quotaGb: '60', queues: '{"aram":false}' });
    s.deleteSetting('quotaGb');
    expect(s.getSetting('quotaGb')).toBeUndefined();
  });

  it('deleteGame cascades to everything', () => {
    const s = memStore();
    const g = s.insertGame({ game_id: 'g', started_at: 1 });
    const seg = s.addSegment(g.id, { seq: 0, path: 'x.mp4' });
    s.bulkInsertEvents(g.id, [{ game_id: 'g', event_id: 0, name: 'GameStart', game_time_s: 0, video_segment_id: seg.id, video_t_ms: 0, payload: {} }]);
    const [m] = s.replaceMoments(g.id, [moment('own_death:1', 0.5, 100)]);
    s.setTags(m!.id, ['skill']);
    s.addNote(g.id, { text: 'n' });
    s.addClip(g.id, { t_in_ms: 0, t_out_ms: 1, path: 'c' });
    s.putTimeline(g.id, 'lcu', {});
    expect(s.deleteGame(g.id)).toBe(true);
    for (const t of ['segments', 'events', 'moments', 'tags', 'notes', 'clips', 'timeline_cache']) {
      expect((s.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n).toBe(0);
    }
    expect(s.getGame(g.id)).toBeUndefined();
  });

  it('getGame returns the full detail and retentionCandidates feeds planRetention', () => {
    const s = memStore();
    const g = s.insertGame({ game_id: 'g', started_at: 1, status: 'ready' });
    s.addSegment(g.id, { seq: 0, path: 'x.mp4', size_bytes: 3_000 });
    const detail = s.getGame(g.id)!;
    expect(detail.game.game_id).toBe('g');
    expect(detail.segments).toHaveLength(1);
    expect(detail.participants).toEqual([]);
    expect(detail.moments).toEqual([]);
    const g2 = s.insertGame({ game_id: 'g2', started_at: 2, status: 'ready' });
    s.addSegment(g2.id, { seq: 0, path: 'y.mp4', size_bytes: 3_000 });
    const plan = planRetention(s.retentionCandidates(), 4_000);
    expect(plan.deletions.map((d) => d.gameId)).toEqual([String(g.id)]);
  });
});
