import { describe, expect, it } from 'vitest';
import {
  EventDataSchema,
  KNOWN_EVENT_NAMES,
  eventActorNames,
  eventStructureId,
  isKnownEvent,
  isUnknownEvent,
  parseLiveEvent,
  type LiveEvent,
} from '../src/index.js';
import { fixture } from './helpers.js';

const EVENT_FIXTURES = [
  'eventdata.sr-2026-01.json',
  'eventdata.legacy.json',
  'eventdata.2026-05.json',
  'eventdata.unknown-and-odd.json',
];

describe('eventdata fixtures', () => {
  it.each(EVENT_FIXTURES)('%s parses', (name) => {
    const r = EventDataSchema.safeParse(fixture(name));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('covers every known event type across the fixtures', () => {
    const seen = new Set<string>();
    for (const name of EVENT_FIXTURES) {
      for (const e of EventDataSchema.parse(fixture(name)).Events) if (isKnownEvent(e)) seen.add(e.EventName);
    }
    expect([...seen].sort()).toEqual([...KNOWN_EVENT_NAMES].sort());
  });

  it('parses the full 2026-01 game as known events only', () => {
    const { Events } = EventDataSchema.parse(fixture('eventdata.sr-2026-01.json'));
    expect(Events.filter(isUnknownEvent)).toEqual([]);
    expect(Events).toHaveLength(23);
  });
});

describe('event payloads', () => {
  const events = EventDataSchema.parse(fixture('eventdata.sr-2026-01.json')).Events;
  const find = <N extends string>(name: N, id?: number): LiveEvent => {
    const e = events.find((x) => x.EventName === name && (id === undefined || x.EventID === id));
    if (!e) throw new Error(`no ${name}`);
    return e;
  };

  it('coerces Stolen strings to booleans', () => {
    const steal = find('HordeKill', 7);
    const notSteal = find('HordeKill', 8);
    if (!isKnownEvent(steal) || steal.EventName !== 'HordeKill') throw new Error('type');
    if (!isKnownEvent(notSteal) || notSteal.EventName !== 'HordeKill') throw new Error('type');
    expect(steal.Stolen).toBe(true);
    expect(notSteal.Stolen).toBe(false);
    const baron = find('BaronKill');
    expect(isKnownEvent(baron) && baron.EventName === 'BaronKill' && baron.Stolen).toBe(true);
  });

  it('keeps float EventTime and numeric EventID', () => {
    const e = find('MinionsSpawning');
    expect(e.EventID).toBe(1);
    expect(e.EventTime).toBeCloseTo(65.0248, 3);
  });

  it('narrows known event types', () => {
    const e = find('Ace');
    if (!isKnownEvent(e) || e.EventName !== 'Ace') throw new Error('type');
    expect(e.AcingTeam).toBe('ORDER');
    expect(e.Acer).toBe('Fake Adc');
    const end = find('GameEnd');
    expect(isKnownEvent(end) && end.EventName === 'GameEnd' && end.Result).toBe('Win');
    const dragon = find('DragonKill', 5);
    expect(isKnownEvent(dragon) && dragon.EventName === 'DragonKill' && dragon.DragonType).toBe('Hextech');
    const mk = find('Multikill');
    expect(isKnownEvent(mk) && mk.EventName === 'Multikill' && mk.KillStreak).toBe(2);
  });

  it('extracts structure IDs from the key named like the event', () => {
    expect(eventStructureId(find('TurretKilled', 10))).toBe('Turret_T200_L2_P3_1509986696');
    expect(eventStructureId(find('InhibKilled'))).toBe('Inhib_T200_L2_P1_2351107073');
    expect(eventStructureId(find('InhibRespawningSoon'))).toBe('Inhib_T200_L2_P1_2351107073');
    expect(eventStructureId(find('InhibRespawned'))).toBe('Inhib_T200_L2_P1_2351107073');
    expect(eventStructureId(find('ChampionKill', 2))).toBeUndefined();
  });

  it('lists actor names', () => {
    expect(eventActorNames(find('ChampionKill', 2))).toEqual(['Fake Top', 'Rival Top', 'Fake Jungle']);
    expect(eventActorNames(find('FirstBlood'))).toEqual(['Fake Top']);
  });

  it('keeps unknown payload keys (loose objects)', () => {
    const e = parseLiveEvent({ EventID: 1, EventName: 'GameStart', EventTime: 0, Extra: 5 });
    expect(e && isKnownEvent(e)).toBe(true);
    expect((e as Record<string, unknown>)['Extra']).toBe(5);
  });
});

describe('unknown events never fail parsing', () => {
  const events = EventDataSchema.parse(fixture('eventdata.unknown-and-odd.json')).Events;

  it('wraps unknown names with the raw payload', () => {
    const feat = events.find((e) => e.EventName === 'FeatOfStrength');
    expect(feat && isUnknownEvent(feat)).toBe(true);
    if (!feat || !isUnknownEvent(feat)) return;
    expect(feat.reason).toBe('unknown-name');
    expect(feat.EventID).toBe(1);
    expect(feat.raw['FeatType']).toBe('FirstTurret');
  });

  it('flags a known name with a bad payload as invalid-payload', () => {
    const bad = events.find((e) => e.EventID === 3);
    expect(bad && isUnknownEvent(bad) && bad.reason).toBe('invalid-payload');
  });

  it('accepts real booleans for Stolen', () => {
    const e = parseLiveEvent({ EventID: 9, EventName: 'BaronKill', EventTime: 1, KillerName: 'a', Assisters: [], Stolen: false });
    expect(e && isKnownEvent(e) && e.EventName === 'BaronKill' && e.Stolen).toBe(false);
  });

  it('returns undefined only for non-events', () => {
    expect(parseLiveEvent(42)).toBeUndefined();
    expect(parseLiveEvent({ EventID: 1 })).toBeUndefined();
    const noId = parseLiveEvent({ EventName: 'X' });
    expect(noId && isUnknownEvent(noId) && Number.isNaN(noId.EventID)).toBe(true);
  });
});
