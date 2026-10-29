import { describe, expect, it } from 'vitest';
import { normalizeEvents } from '../events/normalize.js';
import type { LiveEvent } from '../types.js';
import { DEFAULT_MOMENTS_CONFIG, resolveMomentsConfig } from './config.js';
import { computeMoments, estimateRespawnS, type Moment, type Participant } from './engine.js';
import { groupByTheme, shortlist } from './shortlist.js';

// --- synthetic 25-minute game -------------------------------------------------------------
// Me = "Me" on ORDER with A1..A4; enemies E1..E5 on CHAOS. Game ends 25:00, Lose.

const ME = { name: 'Me', team: 'ORDER' as const };
const participants: Participant[] = [
  { name: 'Me', team: 'ORDER' },
  { name: 'A1', team: 'ORDER' },
  { name: 'A2', team: 'ORDER' },
  { name: 'A3', team: 'ORDER' },
  { name: 'A4', team: 'ORDER' },
  { name: 'E1', team: 'CHAOS' },
  { name: 'E2', team: 'CHAOS' },
  { name: 'E3', team: 'CHAOS' },
  { name: 'E4', team: 'CHAOS' },
  { name: 'E5', team: 'CHAOS' },
];

let nextId = 0;
const ev = <T extends object>(name: string, t: number, fields: T = {} as T): LiveEvent =>
  ({ EventID: nextId++, EventName: name, EventTime: t, ...fields }) as unknown as LiveEvent;
const kill = (t: number, killer: string, victim: string, assisters: string[] = []) => ev('ChampionKill', t, { KillerName: killer, VictimName: victim, Assisters: assisters });

function script(): LiveEvent[] {
  nextId = 0;
  return [
    ev('GameStart', 0),
    ev('MinionsSpawning', 65),
    // 3:10 solo first-blood death
    kill(190, 'E1', 'Me'),
    ev('FirstBlood', 190, { Recipient: 'E1' }),
    // 7:00 own kill with an assist
    kill(420, 'Me', 'E2', ['A1']),
    // 8:00 team grubs
    ev('HordeKill', 480, { Stolen: false, KillerName: 'A2', Assisters: [] }),
    // 9:45 death in a 2-man gank, enemy drake 15 s later
    kill(585, 'E3', 'Me', ['E4']),
    ev('DragonKill', 600, { DragonType: 'Fire', Stolen: false, KillerName: 'E3', Assisters: ['E4'] }),
    // 11:42 solo death, nothing follows
    kill(702, 'E5', 'Me'),
    // 13:00 first tower by me
    ev('TurretKilled', 780, { TurretKilled: 'Turret_T200_L2_P3_1509986696', KillerName: 'Me', Assisters: ['A1'] }),
    ev('FirstBrick', 780, { KillerName: 'Me' }),
    // 15:00 herald, 16:00 drake for the team
    ev('HeraldKill', 900, { Stolen: false, KillerName: 'A2', Assisters: [] }),
    ev('DragonKill', 960, { DragonType: 'Water', Stolen: false, KillerName: 'A2', Assisters: ['A3'] }),
    // 18:00 teamfight: 5 kills in 12 s, I die at 18:10, team keeps killing afterwards
    kill(1080, 'E1', 'A1', ['E2']),
    kill(1083, 'Me', 'E1', ['A2', 'A3']),
    kill(1086, 'A2', 'E2', ['Me']),
    kill(1090, 'E3', 'Me', ['E4', 'E5']),
    kill(1092, 'A3', 'E3', ['A4']),
    // 20:30 solo kill by me
    kill(1230, 'Me', 'E5'),
    // 21:00 Baron stolen by the enemy
    ev('BaronKill', 1260, { Stolen: true, KillerName: 'E4', Assisters: [] }),
    // 22:00 team drake
    ev('DragonKill', 1320, { DragonType: 'Earth', Stolen: false, KillerName: 'A2', Assisters: [] }),
    // 23:55 death, inhibitor lost 5 s later
    kill(1435, 'E1', 'Me', ['E2']),
    ev('InhibKilled', 1440, { InhibKilled: 'Inhib_T100_L1_P1_1931666598', KillerName: 'E1', Assisters: ['E2'] }),
    ev('GameEnd', 1500, { Result: 'Lose' }),
  ];
}

const clock = { toHostNs: (gt: number) => 1e12 + gt * 1e9 };
const segments = [{ id: 7, startNs: 1e12 - 3e9 }];

function compute(extra: Partial<Parameters<typeof computeMoments>[0]> = {}): Moment[] {
  const rows = normalizeEvents(script(), { gameId: 'g', clock, segments });
  return computeMoments({ events: rows, me: ME, participants, ...extra });
}

const byTitle = (moments: Moment[], prefix: string) => moments.find((m) => m.title.startsWith(prefix));

describe('moments engine v1 — synthetic 25 min game', () => {
  it('produces one moment per cluster, sorted by score', () => {
    const moments = compute();
    expect(moments).toHaveLength(13);
    for (let i = 1; i < moments.length; i++) expect(moments[i - 1]!.score).toBeGreaterThanOrEqual(moments[i]!.score);
    expect(moments.every((m) => m.score >= 0 && m.score <= 1)).toBe(true);
    // Deaths dominate the top of the list
    expect(moments[0]!.kind).toBe('own_death');
    expect(moments.slice(0, 4).every((m) => m.theme === 'deaths')).toBe(true);
  });

  it('titles and labels a solo death', () => {
    const m = byTitle(compute(), 'Solo death, 11:42')!;
    expect(m).toBeDefined();
    expect(m.kind).toBe('own_death');
    expect(m.theme).toBe('deaths');
    expect(m.labels).toEqual(expect.arrayContaining(['solo', 'early', 'meaningless']));
    expect(m.labels).not.toContain('sacrifice');
    expect(m.reasons).toEqual(expect.arrayContaining(['No assisters: solo death', 'Nothing followed your death']));
    expect(m.reasons.some((r) => r.includes('laning phase'))).toBe(true);
    expect(m.components.phase).toBe(1);
    expect(m.components.selfInvolvement).toBe(1);
  });

  it('folds FirstBlood into the death instead of a separate moment', () => {
    const moments = compute();
    expect(moments.some((m) => m.title.includes('FirstBlood'))).toBe(false);
    const fb = byTitle(moments, 'Solo death, 3:10')!;
    expect(fb.labels).toContain('first_blood');
    expect(fb.eventIds).toEqual([2]);
  });

  it('labels a gank death traded into an enemy objective', () => {
    const m = byTitle(compute(), 'Death in 2-man collapse traded into Fire drake, 9:45')!;
    expect(m).toBeDefined();
    expect(m.labels).toEqual(expect.arrayContaining(['gank', 'traded_into_objective', 'early']));
    expect(m.reasons.some((r) => r.includes('Enemy took Fire drake 15 s after your death'))).toBe(true);
    expect(m.components.deathCost).toBeGreaterThan(0.5);
    expect(m.eventIds).toHaveLength(2);
    // ranks above the plain solo death at 11:42 because of the trade
    const solo = byTitle(compute(), 'Solo death, 11:42')!;
    expect(m.score).toBeGreaterThan(solo.score);
  });

  it('detects a teamfight death with a sacrifice label', () => {
    const m = byTitle(compute(), 'Teamfight death, 18:10')!;
    expect(m).toBeDefined();
    expect(m.labels).toEqual(expect.arrayContaining(['teamfight', 'sacrifice', 'gank']));
    expect(m.labels).not.toContain('meaningless');
    expect(m.eventIds).toHaveLength(5);
    expect(m.components.participants).toBeGreaterThanOrEqual(0.6);
    expect(m.reasons.some((r) => r.startsWith('Team got a kill 2 s later'))).toBe(true);
    expect(m.reasons).toContain('5 kills within 15 s (teamfight)');
    expect(m.tTriggerS).toBe(1090);
    expect(m.tStartS).toBe(1075); // cluster starts at 1080, minus 5 (earlier than 1090 − 10)
    expect(m.tEndS).toBe(1102); // last kill 1092 + 10
  });

  it('ranks epic objectives with stakes and a stolen bonus', () => {
    const moments = compute();
    const baron = byTitle(moments, 'Baron stolen by enemy, 21:00')!;
    expect(baron.kind).toBe('objective');
    expect(baron.theme).toBe('objectives');
    expect(baron.labels).toContain('stolen');
    expect(baron.components.stakes).toBe(1);
    expect(baron.components.selfInvolvement).toBe(DEFAULT_MOMENTS_CONFIG.involvement.teamEvent);
    const herald = byTitle(moments, 'Team took Herald, 15:00')!;
    expect(herald.components.stakes).toBe(DEFAULT_MOMENTS_CONFIG.stakes.herald);
    expect(baron.score).toBeGreaterThan(herald.score);
    const grubs = byTitle(moments, 'Team took Voidgrubs, 8:00')!;
    expect(grubs.components.stakes).toBe(DEFAULT_MOMENTS_CONFIG.stakes.grubs);
  });

  it('treats the first tower as a structure moment with my involvement', () => {
    const m = byTitle(compute(), 'Team took first tower, 13:00')!;
    expect(m.kind).toBe('structure');
    expect(m.labels).toContain('first_tower');
    expect(m.components.stakes).toBe(DEFAULT_MOMENTS_CONFIG.stakes.firstTower);
    expect(m.components.selfInvolvement).toBe(DEFAULT_MOMENTS_CONFIG.involvement.kill);
    expect(m.reasons).toContain('You took first tower');
  });

  it('labels own kills', () => {
    const moments = compute();
    expect(byTitle(moments, 'Solo kill, 20:30')).toMatchObject({ kind: 'own_kill', theme: 'kills', labels: ['solo'] });
    expect(byTitle(moments, 'Kill, 7:00')).toMatchObject({ kind: 'own_kill', theme: 'kills' });
  });

  it('merges the late death with the inhibitor loss', () => {
    const m = byTitle(compute(), 'Death in 2-man collapse traded into inhibitor, 23:55')!;
    expect(m).toBeDefined();
    expect(m.components.phase).toBe(0.25);
    expect(m.labels).toContain('traded_into_objective');
  });

  it('places the window on video using the trigger event', () => {
    const m = byTitle(compute(), 'Solo death, 11:42')!;
    expect(m.segmentId).toBe(7);
    expect(m.tTriggerMs).toBe(705_000); // 702 s + 3 s recorder lead
    expect(m.tStartMs).toBe(695_000);
    expect(m.tEndMs).toBe(715_000);
    const noVideo = computeMoments({ events: normalizeEvents(script(), { gameId: 'g' }), me: ME, participants });
    expect(noVideo[0]!.segmentId).toBeNull();
    expect(noVideo[0]!.tTriggerMs).toBeNull();
  });

  it('uses the respawn timer from playerlist snapshots when available', () => {
    const moments = compute({
      playerSnapshots: [{ gameTime: 191, players: [{ name: 'Me', isDead: true, respawnTimer: 9, level: 2 }] }],
    });
    const m = byTitle(moments, 'Solo death, 3:10')!;
    expect(m.reasons).toContain('Respawn cost 10 s');
    const estimated = byTitle(compute(), 'Solo death, 3:10')!;
    expect(estimated.reasons.some((r) => r.includes('(estimated)'))).toBe(true);
  });

  it('is stable: ids are derived from the trigger event', () => {
    const a = compute();
    const b = compute();
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
    expect(a[0]!.id).toMatch(/^own_death:\d+$/);
  });
});

describe('moments engine — specific rules', () => {
  it('scores the soul-point and soul drakes higher than ordinary drakes', () => {
    nextId = 0;
    const events = [
      ev('DragonKill', 600, { DragonType: 'Fire', Stolen: false, KillerName: 'E1', Assisters: [] }),
      ev('DragonKill', 900, { DragonType: 'Fire', Stolen: false, KillerName: 'E1', Assisters: [] }),
      ev('DragonKill', 1200, { DragonType: 'Fire', Stolen: false, KillerName: 'E1', Assisters: [] }),
      ev('DragonKill', 1500, { DragonType: 'Fire', Stolen: false, KillerName: 'A1', Assisters: [] }), // denied at soul point
      ev('DragonKill', 1800, { DragonType: 'Fire', Stolen: false, KillerName: 'E1', Assisters: [] }), // soul
    ];
    const rows = normalizeEvents(events, { gameId: 'g' });
    const moments = computeMoments({ events: rows, me: ME, participants }).sort((a, b) => a.tTriggerS - b.tTriggerS);
    expect(moments.map((m) => m.components.stakes)).toEqual([0.5, 0.5, 0.5, 0.85, 0.85]);
    expect(moments[3]!.title).toBe('Team took Fire drake (soul point), 25:00');
    expect(moments[4]!.title).toBe('Enemy took Fire Soul, 30:00');
    expect(moments[4]!.labels).toContain('soul_point');
    const elder = computeMoments({ events: normalizeEvents([ev('DragonKill', 2000, { DragonType: 'Elder', Stolen: true, KillerName: 'Me', Assisters: [] })], { gameId: 'g' }), me: ME, participants });
    expect(elder[0]).toMatchObject({ title: 'Stole Elder dragon, 33:20', components: { stakes: 1, selfInvolvement: 0.6 } });
  });

  it('labels deaths to non-champions as executed', () => {
    nextId = 0;
    const rows = normalizeEvents([kill(300, 'Turret_T200_L1_P2_123', 'Me')], { gameId: 'g' });
    const [m] = computeMoments({ events: rows, me: ME, participants });
    expect(m!.title).toBe('Death to turret, 5:00');
    expect(m!.labels).toContain('executed');
  });

  it('recognises my multikill and an ace', () => {
    nextId = 0;
    const rows = normalizeEvents(
      [kill(1000, 'Me', 'E1'), kill(1003, 'Me', 'E2'), ev('Multikill', 1003, { KillerName: 'Me', KillStreak: 2 }), ev('Ace', 1004, { Acer: 'Me', AcingTeam: 'ORDER' })],
      { gameId: 'g' },
    );
    const [m] = computeMoments({ events: rows, me: ME, participants });
    expect(m!.title).toBe('Double kill, 16:43');
    expect(m!.kind).toBe('own_kill');
    expect(m!.labels).toEqual(expect.arrayContaining(['multikill', 'ace']));
    expect(m!.reasons).toContain('Your team aced them');
  });

  it('ignores clusters without a trigger (other people\'s kills only)', () => {
    nextId = 0;
    const rows = normalizeEvents([kill(500, 'A1', 'E1'), kill(505, 'E2', 'A2')], { gameId: 'g' });
    expect(computeMoments({ events: rows, me: ME, participants })).toEqual([]);
  });

  it('respects weights and pre-roll clamping from the config', () => {
    nextId = 0;
    const rows = normalizeEvents([kill(600, 'E1', 'Me')], { gameId: 'g' });
    const [wide] = computeMoments({ events: rows, me: ME, participants, config: { preRollS: 500 } });
    expect(wide!.tStartS).toBe(600 - 90);
    const [narrow] = computeMoments({ events: rows, me: ME, participants, config: { preRollS: 1 } });
    expect(narrow!.tStartS).toBe(600 - 5);
    const [onlyStakes] = computeMoments({
      events: rows,
      me: ME,
      participants,
      config: { weights: { selfInvolvement: 0, stakes: 1, participants: 0, phase: 0, deathCost: 0 } },
    });
    expect(onlyStakes!.score).toBe(DEFAULT_MOMENTS_CONFIG.stakes.kill);
    const cfg = resolveMomentsConfig({ laner: false });
    expect(cfg.preRollS).toBe(10);
    expect(cfg.laner).toBe(false);
    expect(cfg.weights).toEqual(DEFAULT_MOMENTS_CONFIG.weights);
  });

  it('estimates respawn timers by level and game time', () => {
    expect(estimateRespawnS(1, 120)).toBe(10);
    expect(estimateRespawnS(18, 600)).toBe(52.5);
    expect(estimateRespawnS(10, 30 * 60)).toBeCloseTo(32.5 * 1.255, 1);
    expect(estimateRespawnS(undefined, 20 * 60)).toBeGreaterThan(30);
  });
});

describe('shortlist', () => {
  it('caps the total and per theme, keeping score order', () => {
    const moments = compute();
    const list = shortlist(moments, { max: 8 });
    expect(list.length).toBeLessThanOrEqual(8);
    expect(list.filter((m) => m.theme === 'deaths').length).toBeLessThanOrEqual(5);
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.score).toBeGreaterThanOrEqual(list[i]!.score);

    const twoDeaths = shortlist(moments, { max: 8, perTheme: { deaths: 2 } });
    expect(twoDeaths.filter((m) => m.theme === 'deaths')).toHaveLength(2);
    expect(twoDeaths.some((m) => m.theme === 'objectives')).toBe(true);

    const onlyKills = shortlist(moments, { themes: ['kills'] });
    expect(onlyKills.every((m) => m.theme === 'kills')).toBe(true);
    expect(shortlist(moments, { minScore: 0.99 })).toEqual([]);
  });

  it('groups by theme', () => {
    const g = groupByTheme(compute());
    expect(g.deaths.length).toBe(5);
    expect(g.objectives.length).toBe(6);
    expect(g.kills.length).toBe(2);
    expect(g.team.length).toBe(0);
  });
});
