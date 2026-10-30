import { describe, expect, it } from 'vitest';
import { classifyQueue, DEFAULT_RECORDING_SETTINGS, isRemake, postGameDecision, shouldRecord } from './policy.js';

describe('shouldRecord', () => {
  it('records SR ranked/normal/flex and ARAM by default', () => {
    for (const q of [400, 420, 430, 440, 480, 490, 700]) expect(shouldRecord(q, 'CLASSIC', 11)).toMatchObject({ record: true, category: 'summoners_rift' });
    expect(shouldRecord(450, 'ARAM', 12)).toMatchObject({ record: true, category: 'aram' });
  });

  it('skips Practice Tool, custom, Arena, Brawl, spectate and tutorial by default', () => {
    expect(shouldRecord(0, 'PRACTICETOOL', 11)).toMatchObject({ record: false, category: 'practice_tool' });
    expect(shouldRecord(0, 'CLASSIC', 11)).toMatchObject({ record: false, category: 'custom' });
    expect(shouldRecord(1700, 'CHERRY', 30)).toMatchObject({ record: false, category: 'arena' });
    expect(shouldRecord(null, 'BRAWL', 35)).toMatchObject({ record: false, category: 'brawl' });
    expect(shouldRecord(420, 'CLASSIC', 11, DEFAULT_RECORDING_SETTINGS, true)).toMatchObject({ record: false, category: 'spectate' });
    expect(shouldRecord(2000, 'TUTORIAL', 11)).toMatchObject({ record: false, category: 'tutorial' });
  });

  it('honours settings, except Brawl which is always off', () => {
    const all = { ...DEFAULT_RECORDING_SETTINGS, arena: true, practiceTool: true, custom: true, spectate: true, otherModes: true };
    expect(shouldRecord(1700, 'CHERRY', 30, all).record).toBe(true);
    expect(shouldRecord(0, 'PRACTICETOOL', 11, all).record).toBe(true);
    expect(shouldRecord(900, 'URF', 11, all).record).toBe(true);
    expect(shouldRecord(1300, 'BRAWL', 35, all).record).toBe(false);
    const none = { ...DEFAULT_RECORDING_SETTINGS, summonersRift: false, aram: false, unknown: false };
    expect(shouldRecord(420, 'CLASSIC', 11, none).record).toBe(false);
    expect(shouldRecord(450, 'ARAM', 12, none).record).toBe(false);
    expect(shouldRecord(null, null, null, none).record).toBe(false);
  });

  it('falls back to gameMode/map when the LCU queue is unknown', () => {
    expect(classifyQueue({ queueId: null, gameMode: 'CLASSIC', mapId: 11 })).toBe('summoners_rift');
    expect(classifyQueue({ queueId: null, gameMode: 'ARAM', mapId: 12 })).toBe('aram');
    expect(classifyQueue({ queueId: null, gameMode: 'URF', mapId: 11 })).toBe('other');
    expect(classifyQueue({ queueId: null, gameMode: null, mapId: null })).toBe('unknown');
    expect(shouldRecord(null, null, null).record).toBe(true);
  });
});

describe('remake rule', () => {
  it('is a remake only below 4:00 with Neither', () => {
    expect(isRemake(200, 'Neither')).toBe(true);
    expect(isRemake(239.9, 'Neither')).toBe(true);
    expect(isRemake(240, 'Neither')).toBe(false);
    expect(isRemake(200, 'Lose')).toBe(false);
    expect(isRemake(200, null)).toBe(false);
  });

  it('keeps pinned remakes', () => {
    expect(postGameDecision({ durationS: 100, result: 'Neither', pinned: false })).toEqual({ keep: false, reason: 'remake' });
    expect(postGameDecision({ durationS: 100, result: 'Neither', pinned: true }).keep).toBe(true);
    expect(postGameDecision({ durationS: 1000, result: 'Win', pinned: false }).keep).toBe(true);
  });

  it('records ARAM: Mayhem and other Howling Abyss variants as ARAM', () => {
    expect(classifyQueue({ queueId: 2400, gameMode: 'KIWI', mapId: 12 })).toBe('aram');
    expect(classifyQueue({ queueId: 2401, gameMode: 'NEWMODE', mapId: 12 })).toBe('aram');
    expect(shouldRecord(2400, 'KIWI', null).record).toBe(true);
  });
});
