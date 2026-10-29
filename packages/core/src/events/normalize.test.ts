import { describe, expect, it } from 'vitest';
import type { LiveEvent } from '../types.js';
import { normalizeEvents, otherTeam, placeOnVideo, structureTeam } from './normalize.js';

const events: LiveEvent[] = [
  { EventID: 0, EventName: 'GameStart', EventTime: 0 },
  { EventID: 3, EventName: 'ChampionKill', EventTime: 190.2, KillerName: 'Alice', VictimName: 'Bob', Assisters: [] },
  { EventID: 2, EventName: 'FirstBlood', EventTime: 190.2, Recipient: 'Alice' },
  { EventID: 5, EventName: 'TurretKilled', EventTime: 780, TurretKilled: 'Turret_T200_L2_P3_1509986696', KillerName: 'Alice', Assisters: ['Carol'] },
  { EventID: 4, EventName: 'FirstBrick', EventTime: 780, KillerName: 'Alice' },
  { EventID: 6, EventName: 'ChampionKill', EventTime: 900, KillerName: 'Bob', VictimName: 'Alice', Assisters: ['Dave'] },
  { EventID: 6, EventName: 'ChampionKill', EventTime: 900, KillerName: 'Bob', VictimName: 'Alice', Assisters: ['Dave'] }, // duplicate
];

const clock = { toHostNs: (gt: number) => 1_000_000_000_000 + gt * 1e9 };
const segments = [
  { id: 1, startNs: 1_000_000_000_000 - 2e9, endNs: 1_000_000_000_000 + 500e9 },
  { id: 2, startNs: 1_000_000_000_000 + 700e9 },
];

describe('normalizeEvents', () => {
  it('folds FirstBlood and FirstBrick into their twins as flags and drops duplicates', () => {
    const rows = normalizeEvents(events, { gameId: 'NA1_1', clock, segments });
    expect(rows.map((r) => r.name)).toEqual(['GameStart', 'ChampionKill', 'TurretKilled', 'ChampionKill']);
    const kill = rows[1]!;
    expect(kill.payload).toMatchObject({ firstBlood: true, firstBloodEventId: 2, KillerName: 'Alice', VictimName: 'Bob' });
    expect(kill.payload).not.toHaveProperty('EventName');
    const tower = rows[2]!;
    expect(tower.payload).toMatchObject({ firstBrick: true, firstBrickEventId: 4 });
    expect(rows[3]!.payload).not.toHaveProperty('firstBlood');
    expect(rows.every((r) => r.game_id === 'NA1_1')).toBe(true);
  });

  it('places events on the right segment with ms offsets, null when unplaceable', () => {
    const rows = normalizeEvents(events, { gameId: 'g', clock, segments });
    expect(rows[1]).toMatchObject({ video_segment_id: 1, video_t_ms: 192_200 });
    expect(rows[2]).toMatchObject({ video_segment_id: 2, video_t_ms: 80_000 });
    // 900 s → host +900e9, which is also in segment 2 (open ended)
    expect(rows[3]).toMatchObject({ video_segment_id: 2, video_t_ms: 200_000 });
    const gapRows = normalizeEvents([{ EventID: 9, EventName: 'Ace', EventTime: 600, Acer: 'A', AcingTeam: 'ORDER' }], { gameId: 'g', clock, segments });
    expect(gapRows[0]).toMatchObject({ video_segment_id: null, video_t_ms: null });
    const noClock = normalizeEvents(events, { gameId: 'g' });
    expect(noClock.every((r) => r.video_t_ms === null)).toBe(true);
    expect(placeOnVideo(1, { clock: { toHostNs: () => undefined }, segments })).toBeUndefined();
  });

  it('keeps an orphan FirstBlood as its own flagged row rather than losing it', () => {
    const rows = normalizeEvents([{ EventID: 2, EventName: 'FirstBlood', EventTime: 190.2, Recipient: 'Alice' }], { gameId: 'g' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'FirstBlood', payload: { orphanTwin: true, Recipient: 'Alice' } });
  });

  it('does not fold a FirstBlood onto a kill at a different time', () => {
    const rows = normalizeEvents(
      [
        { EventID: 1, EventName: 'ChampionKill', EventTime: 100, KillerName: 'A', VictimName: 'B', Assisters: [] },
        { EventID: 2, EventName: 'FirstBlood', EventTime: 101, Recipient: 'A' },
      ],
      { gameId: 'g' },
    );
    expect(rows.map((r) => r.name)).toEqual(['ChampionKill', 'FirstBlood']);
    expect(rows[0]!.payload).not.toHaveProperty('firstBlood');
  });
});

describe('structureTeam', () => {
  it('accepts all three structure-ID generations', () => {
    expect(structureTeam('Turret_T2_L_03_A')).toBe('CHAOS');
    expect(structureTeam('Turret_T1_C_05_A')).toBe('ORDER');
    expect(structureTeam('Barracks_T2_R1')).toBe('CHAOS');
    expect(structureTeam('Turret_T100_L2_P3_1509986696')).toBe('ORDER');
    expect(structureTeam('Inhib_T200_L1_P1_1931666598')).toBe('CHAOS');
    expect(structureTeam('Turret_TOrder_L2_P3_123')).toBe('ORDER');
    expect(structureTeam('Turret_TChaos_L2_P3_123')).toBe('CHAOS');
    expect(structureTeam('Something_Else')).toBeUndefined();
    expect(structureTeam(undefined)).toBeUndefined();
    expect(otherTeam('ORDER')).toBe('CHAOS');
  });
});
