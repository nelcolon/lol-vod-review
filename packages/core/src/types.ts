/**
 * Minimal input types for the Live Client Data API (https://127.0.0.1:2999).
 *
 * These mirror the catalogue verified from 2026 captures (docs/research/reports,
 * "Port 2999 emits seventeen event types"). They are deliberately small: `@lvr/core`
 * must not depend on `@lvr/schema` yet.
 *
 * TODO(schema): once `@lvr/schema` lands, re-export its zod-inferred types here
 * (`import type { LiveEvent, ... } from '@lvr/schema'`) and delete the local
 * definitions + `coerceLiveEvent`. The schema layer owns the `"True"/"False"` →
 * boolean coercion of `Stolen` and the three structure-ID formats.
 */

export type Team = 'ORDER' | 'CHAOS';

export type GameResult = 'Win' | 'Lose' | 'Neither';

export type DragonType = 'Air' | 'Water' | 'Fire' | 'Earth' | 'Hextech' | 'Chemtech' | 'Elder' | (string & {});

interface Base<N extends string> {
  EventID: number;
  /** Game seconds, same clock as `/gamestats.gameTime`. */
  EventTime: number;
  EventName: N;
}

export interface GameStartEvent extends Base<'GameStart'> {}
export interface MinionsSpawningEvent extends Base<'MinionsSpawning'> {}
export interface FirstBloodEvent extends Base<'FirstBlood'> {
  Recipient: string;
}
export interface ChampionKillEvent extends Base<'ChampionKill'> {
  /** Bare Riot ID game name; can be a non-champion ("Turret", "Minion", "Baron Nashor"...). */
  KillerName: string;
  VictimName: string;
  Assisters: string[];
}
export interface MultikillEvent extends Base<'Multikill'> {
  KillerName: string;
  /** 2..5 */
  KillStreak: number;
}
export interface AceEvent extends Base<'Ace'> {
  Acer: string;
  AcingTeam: Team;
}
export interface FirstBrickEvent extends Base<'FirstBrick'> {
  KillerName: string;
}
export interface TurretKilledEvent extends Base<'TurretKilled'> {
  /** Structure ID (any of the three generations). */
  TurretKilled: string;
  KillerName: string;
  Assisters: string[];
}
export interface InhibKilledEvent extends Base<'InhibKilled'> {
  InhibKilled: string;
  KillerName: string;
  Assisters: string[];
}
export interface InhibRespawningSoonEvent extends Base<'InhibRespawningSoon'> {
  InhibRespawningSoon: string;
}
export interface InhibRespawnedEvent extends Base<'InhibRespawned'> {
  InhibRespawned: string;
}
interface EpicBase<N extends string> extends Base<N> {
  Stolen: boolean;
  KillerName: string;
  Assisters: string[];
}
export interface DragonKillEvent extends EpicBase<'DragonKill'> {
  DragonType: DragonType;
}
/** Voidgrubs. Asymmetric: one event per grub your team kills, one event total for the enemy. */
export interface HordeKillEvent extends EpicBase<'HordeKill'> {}
export interface HeraldKillEvent extends EpicBase<'HeraldKill'> {}
export interface BaronKillEvent extends EpicBase<'BaronKill'> {}
/** Legacy (removed in V26.01) but still accepted. */
export interface AtakhanKillEvent extends EpicBase<'AtakhanKill'> {}
export interface GameEndEvent extends Base<'GameEnd'> {
  Result: GameResult;
}
/** Passthrough for event names we do not know (forward compatibility). */
export interface UnknownEvent extends Base<string> {
  [key: string]: unknown;
}

export type KnownLiveEvent =
  | GameStartEvent
  | MinionsSpawningEvent
  | FirstBloodEvent
  | ChampionKillEvent
  | MultikillEvent
  | AceEvent
  | FirstBrickEvent
  | TurretKilledEvent
  | InhibKilledEvent
  | InhibRespawningSoonEvent
  | InhibRespawnedEvent
  | DragonKillEvent
  | HordeKillEvent
  | HeraldKillEvent
  | BaronKillEvent
  | AtakhanKillEvent
  | GameEndEvent;

export type LiveEvent = KnownLiveEvent | UnknownEvent;

export type LiveEventName = KnownLiveEvent['EventName'];

export const EPIC_MONSTER_EVENTS = ['DragonKill', 'HordeKill', 'HeraldKill', 'BaronKill', 'AtakhanKill'] as const;
export type EpicMonsterEventName = (typeof EPIC_MONSTER_EVENTS)[number];
export type EpicMonsterEvent = DragonKillEvent | HordeKillEvent | HeraldKillEvent | BaronKillEvent | AtakhanKillEvent;

export function isEpicMonsterEvent(e: LiveEvent): e is EpicMonsterEvent {
  return (EPIC_MONSTER_EVENTS as readonly string[]).includes(e.EventName);
}

/** `/liveclientdata/gamestats` */
export interface GameStats {
  gameMode: string;
  /** Game seconds. */
  gameTime: number;
  mapName: string;
  mapNumber: number;
  mapTerrain: string;
}

/** Subset of `/liveclientdata/playerlist` entries we use. */
export interface PlayerListEntry {
  riotIdGameName: string;
  riotIdTagLine: string;
  /** Older field, may be absent. */
  summonerName?: string;
  championName: string;
  team: Team;
  level: number;
  isDead: boolean;
  /** Seconds until respawn, 0 when alive. */
  respawnTimer: number;
  position: string;
  scores?: {
    kills: number;
    deaths: number;
    assists: number;
    creepScore: number;
    wardScore: number;
  };
}

/** Raw-ish `/liveclientdata/eventdata` body. */
export interface EventDataResponse {
  Events: unknown[];
}

/**
 * Tolerant coercion of one raw 2999 event into `LiveEvent`.
 * Handles `Stolen: "True"/"False"` and missing `Assisters`.
 *
 * TODO(schema): replace with `@lvr/schema`'s zod parser.
 */
export function coerceLiveEvent(raw: unknown): LiveEvent | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const id = r['EventID'];
  const time = r['EventTime'];
  const name = r['EventName'];
  if (typeof id !== 'number' || typeof time !== 'number' || typeof name !== 'string') return undefined;
  const out: Record<string, unknown> = { ...r, EventID: id, EventTime: time, EventName: name };
  if ('Stolen' in r) out['Stolen'] = coerceBool(r['Stolen']);
  if ((EPIC_MONSTER_EVENTS as readonly string[]).includes(name) && !('Stolen' in r)) out['Stolen'] = false;
  if (name === 'ChampionKill' || name === 'TurretKilled' || name === 'InhibKilled' || isEpicName(name)) {
    if (!Array.isArray(out['Assisters'])) out['Assisters'] = [];
  }
  if (name === 'Multikill' && typeof out['KillStreak'] === 'string') out['KillStreak'] = Number(out['KillStreak']);
  return out as unknown as LiveEvent;
}

function isEpicName(name: string): boolean {
  return (EPIC_MONSTER_EVENTS as readonly string[]).includes(name);
}

export function coerceBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim().toLowerCase() === 'true';
  if (typeof v === 'number') return v !== 0;
  return false;
}

/** Format game seconds as `m:ss` (or `h:mm:ss`), e.g. 702 → "11:42", 190 → "3:10". */
export function formatGameTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
