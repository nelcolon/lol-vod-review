import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EventDeduper } from '../src/dedupe.js';

const game = JSON.parse(
  readFileSync(new URL('../../../packages/schema/fixtures/eventdata.sr-2026-01.json', import.meta.url), 'utf8'),
) as { Events: Record<string, unknown>[] };

describe('EventDeduper', () => {
  it('emits each EventID once across cumulative polls', () => {
    const d = new EventDeduper();
    const all = game.Events;
    const r1 = d.ingest(all.slice(0, 3));
    expect(r1.fresh.map((f) => f.parsed?.EventID)).toEqual([0, 1, 2]);
    expect(d.ingest(all.slice(0, 3)).fresh).toEqual([]);
    const r3 = d.ingest(all.slice(0, 6));
    expect(r3.fresh.map((f) => f.parsed?.EventID)).toEqual([3, 4, 5]);
    expect(d.ingest(all).fresh).toHaveLength(all.length - 6);
    expect(d.ingest(all).fresh).toHaveLength(0);
    expect(d.size).toBe(all.length);
  });

  it('does not depend on array order', () => {
    const d = new EventDeduper();
    d.ingest(game.Events.slice(0, 5));
    const r = d.ingest([...game.Events.slice(0, 7)].reverse());
    expect(r.fresh.map((f) => f.parsed?.EventID).sort()).toEqual([5, 6]);
  });

  it('flags a reused EventID with different content', () => {
    const d = new EventDeduper();
    d.ingest([{ EventID: 0, EventName: 'GameStart', EventTime: 0.03 }, { EventID: 1, EventName: 'MinionsSpawning', EventTime: 65 }]);
    const r = d.ingest([{ EventID: 0, EventName: 'GameStart', EventTime: 0.03 }]);
    expect(r.shrunk).toBe(true);
    expect(r.fresh).toEqual([]);
    const r2 = d.ingest([{ EventID: 0, EventName: 'GameStart', EventTime: 0.03 }, { EventID: 1, EventName: 'ChampionKill', EventTime: 300, KillerName: 'a', VictimName: 'b', Assisters: [] }]);
    expect(r2.fresh).toHaveLength(1);
    expect(r2.fresh[0]?.idConflict).toEqual({ previousName: 'MinionsSpawning', previousTime: 65 });
  });

  it('keeps unknown and non-event elements, deduped by content', () => {
    const d = new EventDeduper();
    const odd = [{ EventID: 9, EventName: 'Brand New', EventTime: 1, X: 1 }, 'garbage', { nope: true }];
    const r = d.ingest(odd);
    expect(r.fresh).toHaveLength(3);
    expect(r.fresh[0]?.parsed && 'unknown' in r.fresh[0].parsed).toBe(true);
    expect(r.fresh[1]?.parsed).toBeUndefined();
    expect(d.ingest(odd).fresh).toHaveLength(0);
  });
});
