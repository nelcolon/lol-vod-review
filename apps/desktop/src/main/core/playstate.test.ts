import { describe, expect, it } from 'vitest';
import { computePlayState, diffItems, involvedIn, killsIn, parsePlayersLog, type SavedPlayer } from './playstate';
import type { DdragonData } from './ddragon';

const dd: DdragonData = {
  version: '16.21.1',
  champions: { '51': 'Caitlyn', '15': 'Sivir' },
  items: {
    '2003': { name: 'Health Potion', gold: 50, consumable: true, trinket: false },
    '3031': { name: 'Infinity Edge', gold: 3450, consumable: false, trinket: false },
    '3340': { name: 'Stealth Ward', gold: 0, consumable: false, trinket: true },
  },
};

const p = (name: string, champ: string, team: 'ORDER' | 'CHAOS', level: number, items: Array<[number, number]>): SavedPlayer => ({
  name,
  champion: champ,
  championKey: champ,
  team,
  level,
  isDead: false,
  kills: 0,
  deaths: 0,
  assists: 0,
  items: items.map(([id, count], slot) => ({ id, count, slot })),
  spells: [{ name: 'Flash', key: 'SummonerFlash' }],
});

describe('playstate', () => {
  const log = parsePlayersLog(
    [
      JSON.stringify({ t: 590, players: [p('me', 'Sivir', 'ORDER', 9, [[2003, 3], [3340, 1]]), p('cait', 'Caitlyn', 'CHAOS', 10, [[3031, 1]])] }),
      JSON.stringify({ t: 590, gold: 1200 }),
      JSON.stringify({ t: 598, players: [p('me', 'Sivir', 'ORDER', 9, [[2003, 1], [3340, 1]]), p('cait', 'Caitlyn', 'CHAOS', 11, [[3031, 1]])] }),
      JSON.stringify({ t: 599, gold: 1250 }),
      '{"t": 601, "players": [', // torn line
    ].join('\n'),
  );

  it('reports items used, levels gained, item gold and unspent gold around the trigger', () => {
    const s = computePlayState({
      momentId: '1',
      triggerS: 600,
      beforeS: 590,
      afterS: 605,
      involved: involvedIn([{ name: 'ChampionKill', payload: { KillerName: 'cait', VictimName: 'me', Assisters: [] } }]),
      kills: killsIn([
        { name: 'ChampionKill', payload: { KillerName: 'cait', VictimName: 'me' }, gameTimeS: 600 },
        { name: 'ChampionKill', payload: { KillerName: 'Turret_T1_L_03_A', VictimName: 'cait' }, gameTimeS: 603 },
      ]),
      me: { name: 'me', team: 'ORDER' },
      log,
      participants: [],
      lcu: {
        timeline: { frames: [{ timestamp: 0, participantFrames: {} }] },
        game: { participants: [], participantIdentities: [] },
      },
      dd,
    });
    expect(s.hasItems).toBe(true);
    expect(s.myGold).toBe(1250);
    const [me, cait] = s.players;
    expect(me).toMatchObject({ isMe: true, roles: ['victim'], used: [{ id: 2003, name: 'Health Potion', count: 2 }], bought: [], sold: [], itemGold: 0 });
    expect(cait).toMatchObject({ roles: ['killer'], level: 11, levelBefore: 10, itemGold: 3450 });
    expect(me!.killedBy).toEqual([{ champion: 'Caitlyn', t: 600 }]);
    expect(cait!.killed).toEqual([{ champion: 'Sivir', t: 600 }]);
    expect(cait!.killedBy).toEqual([{ champion: 'Turret', t: 603 }]);
  });

  it('reports a purchase instead of its components, and Stopwatch as used', () => {
    const items = (ids: number[]) => ids.map((id, slot) => ({ id, count: 1, slot }));
    const consumable = (id: number) => id === 2003;
    // Caulfield's Warhammer + Last Whisper -> Serylda's Grudge, plus a potion drunk
    expect(diffItems(items([3133, 3035, 2003]), items([6694]), consumable)).toEqual({ used: [[2003, 1]], bought: [[6694, 1]], sold: [] });
    expect(diffItems(items([2420, 3031]), items([2421, 3031]), consumable)).toEqual({ used: [[2420, 1]], bought: [], sold: [] });
    expect(diffItems(items([3031]), items([]), consumable)).toEqual({ used: [], bought: [], sold: [[3031, 1]] });
  });

  it('falls back to participants and minute gold when items were not saved', () => {
    const s = computePlayState({
      momentId: '1',
      triggerS: 130,
      beforeS: 120,
      afterS: 135,
      involved: new Map(),
      me: { name: 'me', team: 'ORDER' },
      log: { snaps: [], gold: [] },
      participants: [
        { name: 'me', champion: 'Sivir', team: 'ORDER' },
        { name: 'cait', champion: 'Caitlyn', team: 'CHAOS' },
      ],
      lcu: {
        timeline: {
          frames: [
            { timestamp: 0, participantFrames: { '1': { totalGold: 500 }, '2': { totalGold: 500 } } },
            { timestamp: 60_000, participantFrames: { '1': { totalGold: 900 }, '2': { totalGold: 800 } } },
            { timestamp: 120_000, participantFrames: { '1': { totalGold: 1300 }, '2': { totalGold: 1500 } } },
          ],
        },
        game: {
          participants: [
            { participantId: 1, championId: 15, teamId: 100 },
            { participantId: 2, championId: 51, teamId: 200 },
          ],
          participantIdentities: [
            { participantId: 1, player: { gameName: 'me' } },
            { participantId: 2, player: { gameName: 'cait' } },
          ],
        },
      },
      dd,
    });
    expect(s.hasItems).toBe(false);
    expect(s.goldMinute).toBe(2);
    expect(s.players.map((x) => [x.name, x.totalGold])).toEqual([
      ['me', 1300],
      ['cait', 1500],
    ]);
  });
});
