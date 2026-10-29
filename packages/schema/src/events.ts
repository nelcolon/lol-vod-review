/**
 * Live Client Data API `/liveclientdata/eventdata` events.
 *
 * The catalogue is the 17 event types verified from 2026 captures (see
 * docs/research/reports/"LoL VOD review tool landscape.md"). Every event carries
 * `EventID` (number), `EventName` and `EventTime` (float game seconds, same clock as
 * `/gamestats.gameTime`). Payload objects are parsed loosely: extra keys are kept.
 *
 * Unknown event names (and known names whose payload does not match) never fail
 * parsing; they become an {@link UnknownEvent} that keeps the raw payload.
 */
import { z } from 'zod';

/** Team tokens used by the Live Client API. */
export const TeamSchema = z.enum(['ORDER', 'CHAOS']);
export type Team = z.infer<typeof TeamSchema>;

/**
 * `Stolen` arrives as the string "True"/"False". Coerce to boolean; real booleans
 * and lower-case spellings are accepted too in case Riot ever fixes it.
 */
export const StolenSchema = z
  .union([z.boolean(), z.enum(['True', 'False', 'true', 'false'])])
  .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'));

const base = {
  EventID: z.number(),
  EventTime: z.number(),
};

const ev = <N extends string, S extends z.ZodRawShape>(name: N, shape: S) =>
  z.looseObject({ ...base, EventName: z.literal(name), ...shape });

const assisters = z.array(z.string());
const monsterKill = { Stolen: StolenSchema, KillerName: z.string(), Assisters: assisters };

export const GameStartEventSchema = ev('GameStart', {});
export const MinionsSpawningEventSchema = ev('MinionsSpawning', {});
export const FirstBloodEventSchema = ev('FirstBlood', { Recipient: z.string() });
export const ChampionKillEventSchema = ev('ChampionKill', {
  KillerName: z.string(),
  VictimName: z.string(),
  Assisters: assisters,
});
export const MultikillEventSchema = ev('Multikill', {
  KillerName: z.string(),
  KillStreak: z.number().int(),
});
export const AceEventSchema = ev('Ace', { Acer: z.string(), AcingTeam: TeamSchema });
export const FirstBrickEventSchema = ev('FirstBrick', { KillerName: z.string() });
export const TurretKilledEventSchema = ev('TurretKilled', {
  TurretKilled: z.string(),
  KillerName: z.string(),
  Assisters: assisters,
});
export const InhibKilledEventSchema = ev('InhibKilled', {
  InhibKilled: z.string(),
  KillerName: z.string(),
  Assisters: assisters,
});
export const InhibRespawningSoonEventSchema = ev('InhibRespawningSoon', {
  InhibRespawningSoon: z.string(),
});
export const InhibRespawnedEventSchema = ev('InhibRespawned', { InhibRespawned: z.string() });
/** Types seen in 2026 captures: Air, Water, Fire, Earth, Hextech, Chemtech, Elder. Kept open. */
export const DragonTypeSchema = z.string();
export const KNOWN_DRAGON_TYPES = ['Air', 'Water', 'Fire', 'Earth', 'Hextech', 'Chemtech', 'Elder'] as const;
export const DragonKillEventSchema = ev('DragonKill', { DragonType: DragonTypeSchema, ...monsterKill });
/** Voidgrubs. Counts are asymmetric from the active player's point of view. */
export const HordeKillEventSchema = ev('HordeKill', monsterKill);
export const HeraldKillEventSchema = ev('HeraldKill', monsterKill);
export const BaronKillEventSchema = ev('BaronKill', monsterKill);
export const AtakhanKillEventSchema = ev('AtakhanKill', monsterKill);
export const GameResultSchema = z.enum(['Win', 'Lose', 'Neither']);
export const GameEndEventSchema = ev('GameEnd', { Result: GameResultSchema });

export const KnownEventSchema = z.discriminatedUnion('EventName', [
  GameStartEventSchema,
  MinionsSpawningEventSchema,
  FirstBloodEventSchema,
  ChampionKillEventSchema,
  MultikillEventSchema,
  AceEventSchema,
  FirstBrickEventSchema,
  TurretKilledEventSchema,
  InhibKilledEventSchema,
  InhibRespawningSoonEventSchema,
  InhibRespawnedEventSchema,
  DragonKillEventSchema,
  HordeKillEventSchema,
  HeraldKillEventSchema,
  BaronKillEventSchema,
  AtakhanKillEventSchema,
  GameEndEventSchema,
]);
export type KnownEvent = z.output<typeof KnownEventSchema>;
export type KnownEventInput = z.input<typeof KnownEventSchema>;
export type KnownEventName = KnownEvent['EventName'];

export const KNOWN_EVENT_NAMES = [
  'GameStart',
  'MinionsSpawning',
  'FirstBlood',
  'ChampionKill',
  'Multikill',
  'Ace',
  'FirstBrick',
  'TurretKilled',
  'InhibKilled',
  'InhibRespawningSoon',
  'InhibRespawned',
  'DragonKill',
  'HordeKill',
  'HeraldKill',
  'BaronKill',
  'AtakhanKill',
  'GameEnd',
] as const satisfies readonly KnownEventName[];

const knownNameSet: ReadonlySet<string> = new Set(KNOWN_EVENT_NAMES);
export const isKnownEventName = (name: string): name is KnownEventName => knownNameSet.has(name);

/** Event types whose payload names a structure ID, and the key it lives under. */
export const STRUCTURE_ID_KEYS = {
  TurretKilled: 'TurretKilled',
  InhibKilled: 'InhibKilled',
  InhibRespawningSoon: 'InhibRespawningSoon',
  InhibRespawned: 'InhibRespawned',
} as const;

/**
 * Fallback for anything that is not a valid known event. `reason` says whether the
 * name is new to us or a known name arrived with an unexpected payload. `EventID` and
 * `EventTime` are NaN when missing or not numbers, so ordering code still works.
 */
export interface UnknownEvent {
  unknown: true;
  reason: 'unknown-name' | 'invalid-payload';
  EventID: number;
  EventName: string;
  EventTime: number;
  raw: Record<string, unknown>;
}

export const UnknownEventSchema = z
  .looseObject({ EventName: z.string(), EventID: z.unknown(), EventTime: z.unknown() })
  .transform(
    (v): UnknownEvent => ({
      unknown: true,
      reason: isKnownEventName(v.EventName) ? 'invalid-payload' : 'unknown-name',
      EventID: typeof v.EventID === 'number' ? v.EventID : Number.NaN,
      EventName: v.EventName,
      EventTime: typeof v.EventTime === 'number' ? v.EventTime : Number.NaN,
      raw: { ...v },
    }),
  );

/** One element of `Events[]`: a known event, or the passthrough fallback. */
export const LiveEventSchema = z.union([KnownEventSchema, UnknownEventSchema]);
export type LiveEvent = KnownEvent | UnknownEvent;

export const isKnownEvent = (e: LiveEvent): e is KnownEvent => !('unknown' in e && e.unknown === true);
export const isUnknownEvent = (e: LiveEvent): e is UnknownEvent => !isKnownEvent(e);

/** `/liveclientdata/eventdata` → `{ "Events": [...] }`. */
export const EventDataSchema = z.looseObject({ Events: z.array(LiveEventSchema) });
export type EventData = z.output<typeof EventDataSchema>;

/**
 * Parse one raw event without throwing. Returns `undefined` only when the value is not
 * even an object with a string `EventName`.
 */
export function parseLiveEvent(raw: unknown): LiveEvent | undefined {
  const r = LiveEventSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}

/** Structure ID carried by a known event (TurretKilled, Inhib*), if any. */
export function eventStructureId(e: LiveEvent): string | undefined {
  const name = e.EventName;
  if (!(name in STRUCTURE_ID_KEYS)) return undefined;
  const key = STRUCTURE_ID_KEYS[name as keyof typeof STRUCTURE_ID_KEYS];
  const value = isKnownEvent(e) ? (e as Record<string, unknown>)[key] : e.raw[key];
  return typeof value === 'string' ? value : undefined;
}

/** Every actor name mentioned by an event (killer, victim, assisters, recipient, acer). */
export function eventActorNames(e: LiveEvent): string[] {
  const src: Record<string, unknown> = isKnownEvent(e) ? (e as Record<string, unknown>) : e.raw;
  const out: string[] = [];
  for (const k of ['KillerName', 'VictimName', 'Recipient', 'Acer'] as const) {
    const v = src[k];
    if (typeof v === 'string') out.push(v);
  }
  const a = src['Assisters'];
  if (Array.isArray(a)) for (const v of a) if (typeof v === 'string') out.push(v);
  return out;
}
