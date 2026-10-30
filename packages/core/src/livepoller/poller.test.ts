import { describe, expect, it } from 'vitest';
import { FakeClock, FakeScheduler } from '../testing/fakes.js';
import { LiveClientPoller, type FetchLike, type FetchResponseLike, type GameStatsSample, type PlayerListSnapshot, type PollerError, type TimedLiveEvent } from './poller.js';

type Route = (url: string) => FetchResponseLike | Error;

function ok(body: unknown): FetchResponseLike {
  return { ok: true, status: 200, json: async () => body };
}
function status(code: number): FetchResponseLike {
  return { ok: false, status: code, json: async () => ({}) };
}

interface Harness {
  scheduler: FakeScheduler;
  clock: FakeClock;
  poller: LiveClientPoller;
  calls: string[];
  samples: GameStatsSample[];
  events: TimedLiveEvent[];
  playerlists: PlayerListSnapshot[];
  errors: PollerError[];
  first: number;
  lost: number;
  active: Array<{ name: string | null; spectator: boolean }>;
  setRoute(r: Route): void;
}

function harness(route: Route, latencyMs = 10, opts: { hz?: number; lostAfterMs?: number } = {}): Harness {
  const scheduler = new FakeScheduler();
  const clock = new FakeClock(scheduler);
  const h = { scheduler, clock, calls: [] as string[], samples: [] as GameStatsSample[], events: [] as TimedLiveEvent[], playerlists: [] as PlayerListSnapshot[], errors: [] as PollerError[], first: 0, lost: 0, active: [] as Harness['active'] } as Harness;
  let current = route;
  const fetch: FetchLike = async (url) => {
    h.calls.push(url.replace(/^.*\/liveclientdata/, ''));
    scheduler.nowMs += latencyMs; // the request takes time
    const r = current(url);
    if (r instanceof Error) throw r;
    return r;
  };
  h.poller = new LiveClientPoller({
    fetch,
    clock,
    scheduler,
    hz: opts.hz ?? 2,
    lostAfterMs: opts.lostAfterMs ?? 8000,
    requestTimeoutMs: 0,
    onFirstResponse: () => h.first++,
    onGameStats: (s) => h.samples.push(s),
    onEvent: (e) => h.events.push(e),
    onPlayerList: (p) => h.playerlists.push(p),
    onLost: () => h.lost++,
    onError: (e) => h.errors.push(e),
    onActivePlayer: (name, spectator) => h.active.push({ name, spectator }),
  });
  h.setRoute = (r) => (current = r);
  return h;
}

const RAW_EVENTS = [
  { EventID: 0, EventName: 'GameStart', EventTime: 0 },
  { EventID: 1, EventName: 'MinionsSpawning', EventTime: 65.03 },
  { EventID: 2, EventName: 'FirstBlood', EventTime: 190.2, Recipient: 'Alice' },
  { EventID: 3, EventName: 'ChampionKill', EventTime: 190.2, KillerName: 'Alice', VictimName: 'Bob', Assisters: [] },
  { EventID: 4, EventName: 'DragonKill', EventTime: 600, DragonType: 'Fire', Stolen: 'True', KillerName: 'Carol', Assisters: ['Alice'] },
];

function liveRoute(gameTime: () => number, events: () => unknown[], extra: Partial<Record<string, FetchResponseLike | Error>> = {}): Route {
  return (url) => {
    if (url.endsWith('/gamestats')) return ok({ gameMode: 'CLASSIC', gameTime: gameTime(), mapName: 'Map11', mapNumber: 11, mapTerrain: 'Default' });
    if (url.endsWith('/eventdata')) return ok({ Events: events() });
    if (url.endsWith('/playerlist')) return extra['/playerlist'] ?? ok([{ riotIdGameName: 'Alice', riotIdTagLine: 'NA1', championName: 'Ahri', team: 'ORDER', level: 6, isDead: true, respawnTimer: 12.5, position: 'MIDDLE', scores: { kills: 1, deaths: 1, assists: 0, creepScore: 50, wardScore: 1 } }]);
    if (url.endsWith('/activeplayername')) return extra['/activeplayername'] ?? ok('Alice');
    return status(404);
  };
}

describe('LiveClientPoller', () => {
  it('is quiet during the loading screen (404 / ECONNREFUSED) and reports the first 200 once', async () => {
    const h = harness(() => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:2999'), { code: 'ECONNREFUSED' }));
    await h.poller.tick();
    h.setRoute(() => status(404));
    await h.poller.tick();
    expect(h.first).toBe(0);
    expect(h.errors).toEqual([]);
    expect(h.poller.isUp).toBe(false);

    let gt = 0;
    h.setRoute(liveRoute(() => gt, () => []));
    await h.poller.tick();
    gt = 0.5;
    await h.poller.tick();
    expect(h.first).toBe(1);
    expect(h.poller.isUp).toBe(true);
    expect(h.samples.map((s) => s.gameTime)).toEqual([0, 0.5]);
  });

  it('stamps gamestats with the request midpoint on the injected monotonic clock', async () => {
    const h = harness(liveRoute(() => 12, () => []), 10);
    const before = h.clock.hrtimeNs();
    await h.poller.tick();
    const s = h.samples[0]!;
    expect(s.hostNsStart).toBe(before);
    expect(s.hostNsEnd - s.hostNsStart).toBe(10_000_000n);
    expect(s.hostNsMid).toBe(before + 5_000_000n);
    expect(s.stats.gameMode).toBe('CLASSIC');
  });

  it('dedupes events by EventID, coerces Stolen and emits them in ID order with timestamps', async () => {
    let gt = 100;
    let visible = RAW_EVENTS.slice(0, 2);
    const h = harness(liveRoute(() => gt, () => visible));
    await h.poller.tick();
    expect(h.events.map((e) => e.event.EventID)).toEqual([0, 1]);

    visible = [...RAW_EVENTS].reverse(); // cumulative list, order should not matter
    gt = 100.5;
    await h.poller.tick();
    expect(h.events.map((e) => e.event.EventID)).toEqual([0, 1, 2, 3, 4]);
    const drake = h.events[4]!;
    expect(drake.event).toMatchObject({ EventName: 'DragonKill', Stolen: true, Assisters: ['Alice'] });
    expect(drake.observedGameTime).toBe(100.5);
    expect(typeof drake.observedHostNs).toBe('bigint');

    await h.poller.tick();
    expect(h.events).toHaveLength(5);
    expect(h.poller.knownEventIds.size).toBe(5);
  });

  it('polls playerlist at 1 Hz (every other tick at 2 Hz) and maps players', async () => {
    const h = harness(liveRoute(() => 50, () => []));
    await h.poller.tick();
    await h.poller.tick();
    await h.poller.tick();
    expect(h.playerlists).toHaveLength(2);
    expect(h.calls.filter((c) => c === '/playerlist')).toHaveLength(2);
    const p = h.playerlists[0]!.players[0]!;
    expect(p).toMatchObject({ name: 'Alice', team: 'ORDER', championName: 'Ahri', level: 6, isDead: true, respawnTimer: 12.5 });
    expect(h.playerlists[0]!.gameTime).toBe(50);
    expect(h.playerlists[1]!.activePlayerName).toBe('Alice');
  });

  it('keeps items, summoner spells and the Data Dragon champion id', async () => {
    const h = harness(liveRoute(() => 50, () => [], {
      '/playerlist': ok([
        {
          riotIdGameName: 'Bob',
          championName: 'Wukong',
          rawChampionName: 'game_character_displayname_MonkeyKing',
          team: 'CHAOS',
          items: [
            { itemID: 2003, count: 2, slot: 0, consumable: true },
            { itemID: 3078, count: 1, slot: 1 },
          ],
          summonerSpells: {
            summonerSpellOne: { displayName: 'Flash', rawDisplayName: 'GeneratedTip_SummonerSpell_SummonerFlash_DisplayName' },
            summonerSpellTwo: { displayName: 'Unleashed Teleport', rawDisplayName: 'GeneratedTip_SummonerSpell_S12_SummonerTeleportUpgrade_DisplayName' },
          },
        },
      ]),
    }));
    await h.poller.tick();
    const p = h.playerlists[0]!.players[0]!;
    expect(p.championKey).toBe('MonkeyKing');
    expect(p.items).toEqual([
      { id: 2003, count: 2, slot: 0 },
      { id: 3078, count: 1, slot: 1 },
    ]);
    expect(p.spells).toEqual([
      { name: 'Flash', key: 'SummonerFlash' },
      { name: 'Unleashed Teleport', key: 'SummonerTeleportUpgrade' },
    ]);
  });

  it('resolves the active player name once, and flags spectator mode on 400', async () => {
    const h = harness(liveRoute(() => 5, () => []));
    await h.poller.tick();
    await h.poller.tick();
    expect(h.calls.filter((c) => c === '/activeplayername')).toHaveLength(1);
    expect(h.active).toEqual([{ name: 'Alice', spectator: false }]);
    expect(h.poller.activePlayer).toBe('Alice');

    const s = harness(liveRoute(() => 5, () => [], { '/activeplayername': status(400) }));
    await s.poller.tick();
    expect(s.active).toEqual([{ name: null, spectator: true }]);
    expect(s.poller.isSpectator).toBe(true);
    await s.poller.tick();
    expect(s.calls.filter((c) => c === '/activeplayername')).toHaveLength(1);
  });

  it('reports onLost after lostAfterMs of failures, only once, and recovers with a new first response', async () => {
    let gt = 10;
    const h = harness(liveRoute(() => gt, () => []), 10, { lostAfterMs: 8000 });
    await h.poller.tick();
    expect(h.first).toBe(1);

    h.setRoute(() => new Error('ECONNREFUSED'));
    await h.poller.tick();
    expect(h.errors).toHaveLength(1);
    h.scheduler.advance(7000);
    await h.poller.tick();
    expect(h.lost).toBe(0);
    h.scheduler.advance(1000);
    await h.poller.tick();
    expect(h.lost).toBe(1);
    expect(h.poller.isUp).toBe(false);
    await h.poller.tick();
    expect(h.lost).toBe(1);
    expect(h.errors).toHaveLength(1); // quiet again until the next success

    gt = 60;
    h.setRoute(liveRoute(() => gt, () => []));
    await h.poller.tick();
    expect(h.first).toBe(2);
  });

  it('runs on the scheduler at the configured rate and stops cleanly', async () => {
    const h = harness(liveRoute(() => 1, () => []), 0, { hz: 2 });
    h.poller.start();
    await h.scheduler.advanceAsync(2100, 50);
    expect(h.samples.length).toBeGreaterThanOrEqual(4);
    expect(h.samples.length).toBeLessThanOrEqual(6);
    h.poller.stop();
    const n = h.samples.length;
    await h.scheduler.advanceAsync(2000, 50);
    expect(h.samples.length).toBe(n);
    expect(h.poller.isRunning).toBe(false);
    expect(h.scheduler.pending).toBe(0);
  });

  it('resetEvents forgets IDs for a new game', async () => {
    const h = harness(liveRoute(() => 1, () => RAW_EVENTS));
    await h.poller.tick();
    expect(h.events).toHaveLength(5);
    h.poller.resetEvents();
    await h.poller.tick();
    expect(h.events).toHaveLength(10);
  });
});
