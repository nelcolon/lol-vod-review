import { parseLiveEvent, type LiveEvent } from '@lvr/schema';

export interface FreshEvent {
  raw: unknown;
  /** undefined when the element is not even an event-shaped object. */
  parsed: LiveEvent | undefined;
  /** Set when this EventID was seen before with a different name/time (e.g. ID reset on reconnect). */
  idConflict?: { previousName: string; previousTime: number };
}

export interface IngestResult {
  fresh: FreshEvent[];
  /** The array got shorter than the previous one (rewind / reconnect / new game). */
  shrunk: boolean;
  length: number;
}

const keyOf = (raw: unknown, parsed: LiveEvent | undefined): string =>
  parsed && Number.isFinite(parsed.EventID) ? `id:${parsed.EventID}` : `raw:${JSON.stringify(raw)}`;

/**
 * `/eventdata` is cumulative: every poll returns the whole list. Emit each event once,
 * keyed on `EventID`. An ID that comes back with a different EventName/EventTime is
 * emitted again with `idConflict` so ID resets (open question 5) are visible.
 */
export class EventDeduper {
  private readonly seen = new Map<string, { name: string; time: number }>();
  private lastLength = 0;

  get size(): number {
    return this.seen.size;
  }

  ingest(events: readonly unknown[]): IngestResult {
    const fresh: FreshEvent[] = [];
    for (const raw of events) {
      const parsed = parseLiveEvent(raw);
      const key = keyOf(raw, parsed);
      const name = parsed?.EventName ?? '';
      const time = parsed?.EventTime ?? Number.NaN;
      const prev = this.seen.get(key);
      if (!prev) {
        this.seen.set(key, { name, time });
        fresh.push({ raw, parsed });
      } else if (prev.name !== name || !sameTime(prev.time, time)) {
        this.seen.set(key, { name, time });
        fresh.push({ raw, parsed, idConflict: { previousName: prev.name, previousTime: prev.time } });
      }
    }
    const shrunk = events.length < this.lastLength;
    this.lastLength = events.length;
    return { fresh, shrunk, length: events.length };
  }
}

const sameTime = (a: number, b: number): boolean => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-6;
