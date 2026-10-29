import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Recorder } from '../src/recorder.js';
import type { Fetcher } from '../src/types.js';

const refused = () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:2999'), { code: 'ECONNREFUSED' }));
const readJsonl = async (p: string) => (await readFile(p, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

const FAST = { lcuIntervalMs: 20, fastIntervalMs: 10, slowIntervalMs: 20, snapshotEveryMs: 100, gameEndGraceMs: 150, goneAfterMs: 200, watchdogMs: 10, minStallMs: 30 };

/** A fake game: refused, then 404 (loading), then gameTime running, GameEnd after a while. */
function fakeGame(): { fetch: Fetcher; calls: string[] } {
  const started = Date.now();
  const calls: string[] = [];
  const fetch: Fetcher = async (req) => {
    calls.push(req.url);
    const t = Date.now() - started;
    if (req.url.includes('/lol-gameflow/v1/gameflow-phase')) {
      if (!req.headers?.['Authorization']?.startsWith('Basic ')) return { status: 401, body: '' };
      return { status: 200, body: JSON.stringify(t < 60 ? 'ChampSelect' : 'InProgress') };
    }
    if (req.url.includes('/lol-gameflow/v1/session')) return { status: 200, body: JSON.stringify({ phase: 'InProgress', gameData: { gameId: 5, queue: { id: 450, gameMode: 'ARAM' } }, map: { id: 12 } }) };
    if (t < 120) return refused();
    if (t < 200) return { status: 404, body: JSON.stringify({ errorCode: 'RESOURCE_NOT_FOUND', httpStatus: 404, message: 'x' }) };
    const gameTime = (t - 200) / 100;
    const events: unknown[] = [{ EventID: 0, EventName: 'GameStart', EventTime: 0.02 }];
    if (gameTime > 1) events.push({ EventID: 1, EventName: 'Mystery', EventTime: 1 });
    if (gameTime > 2) events.push({ Assisters: [], EventID: 2, EventName: 'TurretKilled', EventTime: 2, KillerName: 'Minion_T100L1S07', TurretKilled: 'Turret_TChaos_L1_P3_1' });
    if (gameTime > 3) events.push({ EventID: 3, EventName: 'GameEnd', EventTime: 3, Result: 'Lose' });
    if (req.url.endsWith('/gamestats')) return { status: 200, body: JSON.stringify({ gameMode: 'ARAM', gameTime, mapName: 'Map12', mapNumber: 12, mapTerrain: 'Default' }) };
    if (req.url.endsWith('/eventdata')) return { status: 200, body: JSON.stringify({ Events: events }) };
    if (req.url.endsWith('/playerlist')) return { status: 200, body: JSON.stringify([{ championName: 'Ahri', isDead: false, level: 1, respawnTimer: 0, scores: { assists: 0, creepScore: 0, deaths: 0, kills: 0, wardScore: 0 }, team: 'ORDER', riotIdGameName: 'Fake One' }]) };
    if (req.url.endsWith('/activeplayername')) return { status: 200, body: '"Fake One"' };
    return { status: 404, body: '' };
  };
  return { fetch, calls };
}

describe('Recorder (mocked fetch)', () => {
  it('follows LCU -> loading -> game -> GameEnd and writes the session folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lvr-ed-'));
    const lockfile = join(dir, 'lockfile');
    await writeFile(lockfile, 'LeagueClient:1:4567:pw:https');
    const { fetch } = fakeGame();
    const rec = new Recorder({ outRoot: join(dir, 'raw'), fetch, lcu: true, lockfilePath: lockfile, timing: FAST, log: () => {} });
    const { outDir, summary } = await rec.run();

    expect(summary.endReason).toBe('game-end');
    expect(summary.lcu.phases.map((p) => p.phase)).toEqual(['ChampSelect', 'InProgress']);
    expect(summary.lcu.sessions[0]).toMatchObject({ queueId: 450, gameMode: 'ARAM', mapId: 12 });
    expect(summary.live.statusCounts['gamestats']?.['ECONNREFUSED']).toBeGreaterThan(0);
    expect(summary.live.statusCounts['gamestats']?.['404']).toBeGreaterThan(0);
    expect(summary.live.first200['gamestats']).toBeDefined();
    expect(summary.gameEnd?.result).toBe('Lose');
    expect(summary.events.histogram).toEqual({ GameStart: 1, Mystery: 1, TurretKilled: 1, GameEnd: 1 });
    expect(summary.events.unknownEventNames).toEqual({ Mystery: 1 });
    expect(summary.structureIds[0]).toMatchObject({ raw: 'Turret_TChaos_L1_P3_1', team: 'CHAOS', recognised: true });
    expect(summary.actors.nonChampion).toMatchObject([{ name: 'Minion_T100L1S07', kind: 'minion' }]);

    const files = (await readdir(outDir)).sort();
    expect(files).toEqual(['eventdata.jsonl', 'gameflow.jsonl', 'gamestats.jsonl', 'playerlist.jsonl', 'probe.jsonl', 'summary.json']);
    const ev = await readJsonl(join(outDir, 'eventdata.jsonl'));
    expect(ev.filter((r) => r['type'] === 'event').map((r) => (r['event'] as { EventID: number }).EventID)).toEqual([0, 1, 2, 3]);
    expect(ev.some((r) => r['type'] === 'snapshot' && r['why'] === 'final')).toBe(true);
    const gsl = await readJsonl(join(outDir, 'gamestats.jsonl'));
    expect(gsl.some((r) => r['status'] === null)).toBe(true);
    for (const r of gsl) expect(typeof r['hrtimeNs_start']).toBe('string');
    const probe = await readJsonl(join(outDir, 'probe.jsonl'));
    expect(probe.some((r) => (r['error'] as { code?: string } | undefined)?.code === 'ECONNREFUSED')).toBe(true);
    expect(JSON.stringify(probe)).not.toContain('cmlvdDpwdw'); // base64 of riot:pw never written
    const gf = await readJsonl(join(outDir, 'gameflow.jsonl'));
    expect(gf.filter((r) => r['type'] === 'phase').map((r) => r['phase'])).toEqual(['ChampSelect', 'InProgress']);
    const pl = await readJsonl(join(outDir, 'playerlist.jsonl'));
    expect(pl.some((r) => r['sameAsPrevious'] === true)).toBe(true);
  });

  it('--no-lcu with nothing listening stops on max-seconds and logs refusals', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lvr-ed-'));
    const rec = new Recorder({ outRoot: dir, fetch: refused, lcu: false, lockfilePath: 'x', maxSeconds: 0.3, timing: FAST, log: () => {} });
    const { summary } = await rec.run();
    expect(summary.endReason).toBe('max-seconds');
    expect(summary.live.firstResponse).toBeNull();
    expect(summary.live.statusCounts['eventdata']?.['ECONNREFUSED']).toBeGreaterThan(0);
  });

  it('stops with 2999-gone after the API disappears', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lvr-ed-'));
    const started = Date.now();
    const fetch: Fetcher = async () => (Date.now() - started < 100 ? { status: 200, body: '{"Events":[]}' } : refused());
    const rec = new Recorder({ outRoot: dir, fetch, lcu: false, lockfilePath: 'x', maxSeconds: 5, timing: FAST, log: () => {} });
    const { summary } = await rec.run();
    expect(summary.endReason).toBe('2999-gone');
  });

  it('stop() flushes like Ctrl-C', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lvr-ed-'));
    const rec = new Recorder({ outRoot: dir, fetch: refused, lcu: false, lockfilePath: 'x', timing: FAST, log: () => {} });
    setTimeout(() => rec.stop('sigint'), 100);
    const { outDir, summary } = await rec.run();
    expect(summary.endReason).toBe('sigint');
    const saved = JSON.parse(await readFile(join(outDir, 'summary.json'), 'utf8')) as { endReason: string };
    expect(saved.endReason).toBe('sigint');
  });
});
