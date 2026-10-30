/**
 * Queue gating and remake rules (PLAN §3.3).
 *
 * Record only queues the user enabled. Defaults: Summoner's Rift normal/ranked/flex (and
 * the other SR matchmade queues: swiftplay, quickplay, clash) and ARAM. Off: Practice
 * Tool, custom games, Arena, Brawl, spectate/replay, everything else. Riot forbids
 * aggregating Brawl data, so Brawl stays off regardless of settings.
 */

export interface RecordingSettings {
  /** Summoner's Rift matchmade queues (normal draft/blind, ranked solo, flex, swiftplay, quickplay, clash). */
  summonersRift: boolean;
  aram: boolean;
  arena: boolean;
  practiceTool: boolean;
  custom: boolean;
  spectate: boolean;
  /** URF, One for All, Nexus Blitz, Ultimate Spellbook, tutorial, anything unrecognised. */
  otherModes: boolean;
  /** Record games whose queue we could not classify (e.g. LCU unavailable). */
  unknown: boolean;
}

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  summonersRift: true,
  aram: true,
  arena: false,
  practiceTool: false,
  custom: false,
  spectate: false,
  otherModes: false,
  unknown: true,
};

export type QueueCategory =
  | 'summoners_rift'
  | 'aram'
  | 'arena'
  | 'brawl'
  | 'practice_tool'
  | 'custom'
  | 'spectate'
  | 'tutorial'
  | 'other'
  | 'unknown';

/** Known queue IDs (Riot `queues.json`). */
export const SR_QUEUE_IDS: ReadonlySet<number> = new Set([
  400, // normal draft
  420, // ranked solo/duo
  430, // normal blind
  440, // ranked flex
  480, // swiftplay
  490, // quickplay
  700, // clash
]);
export const ARAM_QUEUE_IDS: ReadonlySet<number> = new Set([450, 720 /* ARAM clash */, 2400 /* ARAM: Mayhem */]);
export const ARENA_QUEUE_IDS: ReadonlySet<number> = new Set([1700, 1710]);
/** Brawl queue id is not confirmed; gate Brawl on gameMode/map as well. */
export const BRAWL_QUEUE_IDS: ReadonlySet<number> = new Set([1300]);
export const TUTORIAL_QUEUE_IDS: ReadonlySet<number> = new Set([2000, 2010, 2020]);

export const MAP_SUMMONERS_RIFT = 11;
export const MAP_HOWLING_ABYSS = 12;
export const MAP_ARENA = 30;
export const MAP_BRAWL = 35;

export interface GameInfo {
  /** From the LCU session; null when unknown. */
  queueId: number | null;
  /** `/gamestats.gameMode`: CLASSIC, ARAM, PRACTICETOOL, CHERRY (Arena), BRAWL, URF, TUTORIAL... */
  gameMode: string | null;
  /** `/gamestats.mapNumber` */
  mapId: number | null;
  /** True when the 2999 `/activeplayer*` endpoints answer 400 (spectator/replay). */
  spectator?: boolean;
}

export function classifyQueue(info: GameInfo): QueueCategory {
  const mode = (info.gameMode ?? '').toUpperCase();
  if (info.spectator) return 'spectate';
  if (mode === 'PRACTICETOOL') return 'practice_tool';
  if (mode === 'TUTORIAL' || (info.queueId !== null && TUTORIAL_QUEUE_IDS.has(info.queueId))) return 'tutorial';
  if (mode === 'BRAWL' || info.mapId === MAP_BRAWL || (info.queueId !== null && BRAWL_QUEUE_IDS.has(info.queueId)))
    return 'brawl';
  if (mode === 'CHERRY' || info.mapId === MAP_ARENA || (info.queueId !== null && ARENA_QUEUE_IDS.has(info.queueId)))
    return 'arena';
  if (info.queueId !== null) {
    if (info.queueId === 0) return 'custom';
    if (SR_QUEUE_IDS.has(info.queueId)) return 'summoners_rift';
    // Howling Abyss variants (ARAM: Mayhem's gameMode is KIWI) are ARAM too.
    if (ARAM_QUEUE_IDS.has(info.queueId) || info.mapId === MAP_HOWLING_ABYSS) return 'aram';
    return 'other';
  }
  // No LCU: fall back to gameMode + map.
  if (mode === 'CLASSIC' && info.mapId === MAP_SUMMONERS_RIFT) return 'summoners_rift';
  if (mode === 'ARAM' || info.mapId === MAP_HOWLING_ABYSS) return 'aram';
  if (mode === '' && info.mapId === null) return 'unknown';
  return 'other';
}

export interface RecordDecision {
  record: boolean;
  category: QueueCategory;
  reason: string;
}

/**
 * Should this game be recorded? `queueId` from the LCU session (null if unavailable),
 * `gameMode`/`mapId` from `/gamestats`.
 */
export function shouldRecord(
  queueId: number | null,
  gameMode: string | null,
  mapId: number | null,
  settings: RecordingSettings = DEFAULT_RECORDING_SETTINGS,
  spectator = false,
): RecordDecision {
  const category = classifyQueue({ queueId, gameMode, mapId, spectator });
  const decide = (record: boolean, why: string): RecordDecision => ({ record, category, reason: why });
  switch (category) {
    case 'brawl':
      return decide(false, 'Brawl: Riot forbids storing Brawl data');
    case 'summoners_rift':
      return decide(settings.summonersRift, settings.summonersRift ? 'Summoner\'s Rift queue enabled' : 'Summoner\'s Rift disabled in settings');
    case 'aram':
      return decide(settings.aram, settings.aram ? 'ARAM enabled' : 'ARAM disabled in settings');
    case 'arena':
      return decide(settings.arena, settings.arena ? 'Arena enabled' : 'Arena disabled in settings');
    case 'practice_tool':
      return decide(settings.practiceTool, settings.practiceTool ? 'Practice Tool enabled' : 'Practice Tool disabled in settings');
    case 'custom':
      return decide(settings.custom, settings.custom ? 'Custom games enabled' : 'Custom games disabled in settings');
    case 'spectate':
      return decide(settings.spectate, settings.spectate ? 'Spectate enabled' : 'Spectate/replay disabled in settings');
    case 'tutorial':
      return decide(false, 'Tutorial never recorded');
    case 'other':
      return decide(settings.otherModes, settings.otherModes ? 'Other modes enabled' : `Mode ${gameMode ?? '?'} / queue ${queueId ?? '?'} disabled in settings`);
    case 'unknown':
      return decide(settings.unknown, settings.unknown ? 'Queue unknown, recording by default' : 'Queue unknown, skipping');
  }
}

export const REMAKE_MAX_DURATION_S = 4 * 60;

/** A game that ended with `Neither` before 4:00 is a remake. */
export function isRemake(durationS: number, result: string | null | undefined): boolean {
  return result === 'Neither' && durationS < REMAKE_MAX_DURATION_S;
}

export interface PostGameDecision {
  keep: boolean;
  reason: string;
}

/** Remake → discard unless the user pinned the game. */
export function postGameDecision(input: { durationS: number; result: string | null | undefined; pinned: boolean }): PostGameDecision {
  if (isRemake(input.durationS, input.result)) {
    return input.pinned ? { keep: true, reason: 'remake but pinned' } : { keep: false, reason: 'remake' };
  }
  return { keep: true, reason: 'normal game' };
}
