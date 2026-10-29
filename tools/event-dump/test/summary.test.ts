import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EventDeduper } from '../src/dedupe.js';
import { Summarizer, formatSummary } from '../src/summary.js';
import type { AttemptRecord } from '../src/types.js';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../../packages/schema/fixtures/${n}`, import.meta.url), 'utf8')) as unknown;
const T0 = Date.UTC(2026, 9, 29, 12, 0, 0);

/** Attempt at wall offset `ms` (hrtime = ms in ns, 10 ms round trip). */
const at = (endpoint: string, ms: number, status: number | null, body?: unknown): AttemptRecord => ({
  endpoint,
  url: `https://127.0.0.1:2999/liveclientdata/${endpoint}`,
  wallMs: T0 + ms,
  hrtimeNs_start: String(BigInt(ms) * 1_000_000n),
  hrtimeNs_end: String(BigInt(ms + 10) * 1_000_000n),
  status,
  durationMs: 10,
  ...(body !== undefined ? { body } : {}),
  ...(status === null ? { error: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:2999' } } : {}),
});
const gs = (gameTime: number) => ({ gameMode: 'CLASSIC', gameTime, mapName: 'Map11', mapNumber: 11, mapTerrain: 'Default' });

describe('Summarizer', () => {
  it('records loading-screen failures, first 200s, stalls and regressions', () => {
    const s = new Summarizer(T0, true);
    s.onLockfile(true);
    s.onPhase('ChampSelect', T0);
    s.onPhase('InProgress', T0 + 500);
    s.onSession({ phase: 'InProgress', gameId: 1, queueId: 420, gameMode: 'CLASSIC', mapId: 11 });
    s.onLiveAttempt(at('gamestats', 1000, null));
    s.onLiveAttempt(at('gamestats', 1250, null));
    s.onLiveAttempt(at('gamestats', 1500, 404, { errorCode: 'RESOURCE_NOT_FOUND', httpStatus: 404 }));
    // loading: gameTime frozen at 0 for 3 s, then running 1:1, then a 2 s pause at 10.0
    const samples: [number, number][] = [];
    for (let ms = 2000; ms <= 5000; ms += 250) samples.push([ms, 0]);
    for (let ms = 5250; ms <= 15000; ms += 250) samples.push([ms, (ms - 5000) / 1000]);
    for (let ms = 15250; ms <= 17000; ms += 250) samples.push([ms, 10]);
    for (let ms = 17250; ms <= 18000; ms += 250) samples.push([ms, 10 + (ms - 17000) / 1000]);
    samples.push([18250, 5]); // regression (e.g. chronobreak)
    for (const [ms, t] of samples) {
      const a = at('gamestats', ms, 200, gs(t));
      s.onLiveAttempt(a);
      s.onGameStats(gs(t), a);
    }
    const sum = s.finalize('sigint', T0 + 20000);

    expect(sum.endReason).toBe('sigint');
    expect(sum.durationMs).toBe(20000);
    expect(sum.live.statusCounts['gamestats']).toMatchObject({ ECONNREFUSED: 2, '404': 1 });
    expect(sum.live.firstResponse).toMatchObject({ endpoint: 'gamestats', status: 404, wallMs: T0 + 1500 });
    expect(sum.live.first200['gamestats']).toMatchObject({ wallMs: T0 + 2000, msAfterFirstResponse: 500 });
    expect(sum.lcu.phases.map((p) => p.phase)).toEqual(['ChampSelect', 'InProgress']);
    expect(sum.lcu.sessions[0]?.queueId).toBe(420);
    expect(sum.gameTimeStalls).toHaveLength(2);
    expect(sum.gameTimeStalls[0]).toMatchObject({ gameTime: 0, durationMs: 3000, samples: 13 });
    expect(sum.gameTimeStalls[1]).toMatchObject({ gameTime: 10, durationMs: 2000 });
    expect(sum.gameTimeRegressions).toEqual([{ from: 11, to: 5, wallMs: T0 + 18250 }]);
    // gameTime 0 ~ wall 5000 ms (+5 ms midpoint)
    expect(sum.gamestats.estimatedGameZeroWallMs).toBe(T0 + 5005);
    expect(sum.gamestats).toMatchObject({ gameMode: 'CLASSIC', mapNumber: 11, firstGameTime: 0, lastGameTime: 5 });
  });

  it('marks a stall still open at the end', () => {
    const s = new Summarizer(T0, false);
    for (let ms = 0; ms <= 3000; ms += 250) s.onGameStats(gs(42), at('gamestats', ms, 200));
    expect(s.finalize('2999-gone', T0 + 3000).gameTimeStalls).toEqual([
      { gameTime: 42, startWallMs: T0 + 5, endWallMs: T0 + 3005, durationMs: 3000, samples: 13, open: true },
    ]);
  });

  it('summarises events: histogram, unknowns, structures, actors, start/end', () => {
    const s = new Summarizer(T0, false);
    const d = new EventDeduper();
    const players = (fx('playerlist.json') as { riotIdGameName: string }[]).map((p) => p.riotIdGameName);
    s.onPlayerNames(players);
    const main = (fx('eventdata.sr-2026-01.json') as { Events: unknown[] }).Events;
    const odd = (fx('eventdata.unknown-and-odd.json') as { Events: unknown[] }).Events;
    // first poll: partial; second: full; third: the odd list (shorter -> shrink, IDs reused)
    for (const [i, list] of [main.slice(0, 4), main, odd].entries()) {
      const a = at('eventdata', 1000 * (i + 1), 200, { Events: list });
      const r = d.ingest(list);
      s.onEventArray(r.shrunk);
      s.onFreshEvents(r.fresh, a);
    }
    const sum = s.finalize('game-end', T0 + 5000);

    expect(sum.gameStart).toMatchObject({ eventId: 0, firstSeen: { wallMs: T0 + 1000 } });
    expect(sum.gameEnd).toMatchObject({ result: 'Win', eventTime: 2400.5 });
    expect(sum.events.histogram['ChampionKill']).toBe(5); // 4 valid + 1 invalid-payload
    expect(sum.events.histogram['TurretKilled']).toBe(3);
    expect(sum.events.unknownEventNames).toEqual({ FeatOfStrength: 1, VoidgrubKill: 1 });
    expect(sum.events.invalidPayloadEvents).toEqual([{ EventID: 3, EventName: 'ChampionKill' }]);
    expect(sum.events.arrayShrinks).toBe(1);
    expect(sum.events.eventIdConflicts.map((c) => c.EventID)).toEqual([0, 1, 2, 3, 4, 5]); // odd GameStart has a different EventTime too
    expect(sum.events.maxEventId).toBe(22);
    expect(sum.unrecognisedStructureIds).toEqual(['Something_Else_Entirely', 'Turret_TNeutral_L9_P0_42']);
    const inhib = sum.structureIds.find((x) => x.raw === 'Inhib_T200_L2_P1_2351107073');
    expect(inhib).toMatchObject({ kind: 'inhibitor', team: 'CHAOS', count: 3, eventNames: ['InhibKilled', 'InhibRespawned', 'InhibRespawningSoon'] });
    const kinds = Object.fromEntries(sum.actors.nonChampion.map((a) => [a.name, a.kind]));
    expect(kinds).toMatchObject({
      Minion_T200L1S07: 'minion',
      Minion_T100L1S07: 'minion',
      Turret_T200_L0_P3_511845594: 'turret',
      SRU_Baron: 'monster',
    });
    expect(kinds['Fake Top']).toBeUndefined();
    const baron = sum.actors.nonChampion.find((a) => a.name === 'SRU_Baron');
    expect(baron).toMatchObject({ roles: ['KillerName'], eventNames: ['ChampionKill'] });

    const text = formatSummary(sum, 'X');
    expect(text).toContain('UNKNOWN events: FeatOfStrength, VoidgrubKill');
    expect(text).toContain('GameEnd:       Win');
  });
});
