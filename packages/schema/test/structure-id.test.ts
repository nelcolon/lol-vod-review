import { describe, expect, it } from 'vitest';
import { EventDataSchema, eventStructureId, isRecognisedStructureId, parseStructureId } from '../src/index.js';
import { fixture } from './helpers.js';

interface Expected {
  id: string;
  kind: string;
  team?: string;
  lane?: string;
  laneToken?: string;
  laneGuess?: string;
  position?: string;
  hash?: string;
  generation: string;
}

describe('parseStructureId', () => {
  const cases = fixture('structure-ids.json') as Expected[];

  it.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const p = parseStructureId(c.id);
    expect(p.raw).toBe(c.id);
    expect(p.kind).toBe(c.kind);
    expect(p.team).toBe(c.team);
    expect(p.lane).toBe(c.lane);
    expect(p.laneToken).toBe(c.laneToken);
    if (c.laneGuess) expect(p.laneGuess).toBe(c.laneGuess);
    expect(p.position).toBe(c.position);
    expect(p.hash).toBe(c.hash);
    expect(p.generation).toBe(c.generation);
  });

  it('flags 2026 lane names as unconfirmed guesses, legacy as confirmed', () => {
    expect(parseStructureId('Turret_T100_L2_P3_1509986696').laneGuessConfirmed).toBe(false);
    expect(parseStructureId('Turret_T2_L_03_A').laneGuessConfirmed).toBe(true);
  });

  it('never throws', () => {
    for (const s of ['', '_', 'Turret', 'Turret_', 'Turret_T3_X', 'HQ_T1', 'Nexus_TOrder']) {
      expect(() => parseStructureId(s)).not.toThrow();
    }
    expect(parseStructureId('HQ_T1')).toMatchObject({ kind: 'nexus', team: 'ORDER' });
    expect(parseStructureId('Turret_T3_X').team).toBeUndefined();
  });

  it('recognises every structure ID in the event fixtures except the deliberate oddities', () => {
    const files = ['eventdata.sr-2026-01.json', 'eventdata.legacy.json', 'eventdata.2026-05.json'];
    for (const f of files) {
      for (const e of EventDataSchema.parse(fixture(f)).Events) {
        const id = eventStructureId(e);
        if (id) expect(isRecognisedStructureId(parseStructureId(id)), id).toBe(true);
      }
    }
    const odd = EventDataSchema.parse(fixture('eventdata.unknown-and-odd.json')).Events.map(eventStructureId).filter(Boolean);
    expect(odd.map((id) => isRecognisedStructureId(parseStructureId(id as string)))).toEqual([false, false]);
  });
});
