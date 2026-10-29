/**
 * Live Client Data API (https://127.0.0.1:2999/liveclientdata/*) payloads.
 *
 * Objects are parsed with `looseObject` (unknown keys kept) and most nested data is
 * optional, because Riot changes these payloads without notice and spectator mode
 * strips the active-player block. Validation is a diagnostic, not a gate.
 */
import { z } from 'zod';
import { EventDataSchema, TeamSchema } from './events.js';

export const LIVE_CLIENT_BASE_URL = 'https://127.0.0.1:2999';

export const LIVE_CLIENT_ENDPOINTS = {
  allgamedata: '/liveclientdata/allgamedata',
  activeplayer: '/liveclientdata/activeplayer',
  activeplayername: '/liveclientdata/activeplayername',
  playerlist: '/liveclientdata/playerlist',
  eventdata: '/liveclientdata/eventdata',
  gamestats: '/liveclientdata/gamestats',
} as const;
export type LiveClientEndpoint = keyof typeof LIVE_CLIENT_ENDPOINTS;

/** `/gamestats` (also `allgamedata.gameData`). `gameTime` is float game seconds. */
export const GameStatsSchema = z.looseObject({
  gameMode: z.string(),
  gameTime: z.number(),
  mapName: z.string(),
  mapNumber: z.number(),
  mapTerrain: z.string(),
});
export type GameStats = z.output<typeof GameStatsSchema>;

/** `/activeplayername`: a bare JSON string (`"Unknown"` in spectator mode). */
export const ActivePlayerNameSchema = z.string();

const RuneSchema = z.looseObject({
  displayName: z.string().optional(),
  id: z.number().optional(),
  rawDescription: z.string().optional(),
  rawDisplayName: z.string().optional(),
});

const AbilitySchema = z.looseObject({
  abilityLevel: z.number().optional(),
  displayName: z.string().optional(),
  id: z.string().optional(),
  rawDescription: z.string().optional(),
  rawDisplayName: z.string().optional(),
});

export const ActivePlayerSchema = z.looseObject({
  abilities: z.record(z.string(), AbilitySchema).optional(),
  championStats: z.record(z.string(), z.unknown()).optional(),
  currentGold: z.number().optional(),
  fullRunes: z.record(z.string(), z.unknown()).optional(),
  level: z.number(),
  riotId: z.string().optional(),
  riotIdGameName: z.string().optional(),
  riotIdTagLine: z.string().optional(),
  summonerName: z.string().optional(),
  teamRelativeColors: z.boolean().optional(),
});
export type ActivePlayer = z.output<typeof ActivePlayerSchema>;

/** Spectator/replay: `allgamedata.activePlayer` is `{ "error": "Spectator mode doesn't ..." }`. */
export const ActivePlayerErrorSchema = z.looseObject({ error: z.string() });

/** HTTP 4xx body of the API, e.g. 400 RPC_ERROR in spectator mode, 404 RESOURCE_NOT_FOUND. */
export const LiveClientErrorSchema = z.looseObject({
  errorCode: z.string(),
  httpStatus: z.number(),
  message: z.string().optional(),
});
export type LiveClientError = z.output<typeof LiveClientErrorSchema>;

const ItemSchema = z.looseObject({
  canUse: z.boolean().optional(),
  consumable: z.boolean().optional(),
  count: z.number().optional(),
  displayName: z.string().optional(),
  itemID: z.number(),
  price: z.number().optional(),
  rawDescription: z.string().optional(),
  rawDisplayName: z.string().optional(),
  slot: z.number().optional(),
});

export const PlayerScoresSchema = z.looseObject({
  assists: z.number(),
  creepScore: z.number(),
  deaths: z.number(),
  kills: z.number(),
  wardScore: z.number(),
});

export const PlayerSchema = z.looseObject({
  championName: z.string(),
  isBot: z.boolean().optional(),
  isDead: z.boolean(),
  items: z.array(ItemSchema).optional(),
  level: z.number(),
  /** Lane/role string (`TOP`, `JUNGLE`, `MIDDLE`, `BOTTOM`, `UTILITY`, `NONE`, ``), not coordinates. */
  position: z.string().optional(),
  rawChampionName: z.string().optional(),
  rawSkinName: z.string().optional(),
  respawnTimer: z.number(),
  riotId: z.string().optional(),
  riotIdGameName: z.string().optional(),
  riotIdTagLine: z.string().optional(),
  runes: z
    .looseObject({
      keystone: RuneSchema.optional(),
      primaryRuneTree: RuneSchema.optional(),
      secondaryRuneTree: RuneSchema.optional(),
    })
    .optional(),
  scores: PlayerScoresSchema,
  skinID: z.number().optional(),
  skinName: z.string().optional(),
  summonerName: z.string().optional(),
  summonerSpells: z.record(z.string(), z.unknown()).optional(),
  /** ORDER/CHAOS in normal games; kept open for odd modes. */
  team: z.union([TeamSchema, z.string()]),
});
export type Player = z.output<typeof PlayerSchema>;

export const PlayerListSchema = z.array(PlayerSchema);
export type PlayerList = z.output<typeof PlayerListSchema>;

export const AllGameDataSchema = z.looseObject({
  activePlayer: z.union([ActivePlayerSchema, ActivePlayerErrorSchema]),
  allPlayers: PlayerListSchema,
  events: EventDataSchema,
  gameData: GameStatsSchema,
});
export type AllGameData = z.output<typeof AllGameDataSchema>;

/** The name `KillerName`/`VictimName` use for a player: the bare Riot ID game name. */
export function playerGameName(p: Pick<Player, 'riotIdGameName' | 'riotId' | 'summonerName'>): string | undefined {
  if (p.riotIdGameName) return p.riotIdGameName;
  if (p.riotId) {
    const i = p.riotId.lastIndexOf('#');
    return i > 0 ? p.riotId.slice(0, i) : p.riotId;
  }
  return p.summonerName;
}
