/**
 * League Client (LCU) payloads. The LCU is unofficial: model loosely, keep everything.
 */
import { z } from 'zod';

export const DEFAULT_LOCKFILE_PATH = 'C:\\Riot Games\\League of Legends\\lockfile';

export interface Lockfile {
  processName: string;
  pid: number;
  port: number;
  password: string;
  protocol: string;
}

export const LockfileSchema = z.object({
  processName: z.string().min(1),
  pid: z.number().int().nonnegative(),
  port: z.number().int().min(1).max(65535),
  password: z.string().min(1),
  protocol: z.string().min(1),
});

/**
 * Parse the one-line lockfile `ProcessName:PID:Port:Password:Protocol`.
 * Throws on malformed content. The password may not contain ':' (it never has), but the
 * process name is taken as everything before the last four fields just in case.
 */
export function parseLockfile(text: string): Lockfile {
  const line = text.trim().split(/\r?\n/)[0] ?? '';
  const parts = line.split(':');
  if (parts.length < 5) throw new Error(`lockfile: expected 5 ':'-separated fields, got ${parts.length}`);
  const protocol = parts.pop() as string;
  const password = parts.pop() as string;
  const port = Number(parts.pop());
  const pid = Number(parts.pop());
  const processName = parts.join(':');
  return LockfileSchema.parse({ processName, pid, port, password, protocol });
}

/** Basic auth header value for the LCU: `riot:<password>`. */
export const lcuAuthHeader = (lf: Pick<Lockfile, 'password'>): string =>
  `Basic ${Buffer.from(`riot:${lf.password}`).toString('base64')}`;

export const lcuBaseUrl = (lf: Pick<Lockfile, 'port' | 'protocol'>): string =>
  `${lf.protocol || 'https'}://127.0.0.1:${lf.port}`;

export const GAMEFLOW_PHASES = [
  'None',
  'Lobby',
  'Matchmaking',
  'CheckedIntoTournament',
  'ReadyCheck',
  'ChampSelect',
  'GameStart',
  'FailedToLaunch',
  'InProgress',
  'Reconnect',
  'WaitingForStats',
  'PreEndOfGame',
  'EndOfGame',
  'TerminatedInError',
] as const;
export const GameflowPhaseSchema = z.enum(GAMEFLOW_PHASES);
export type GameflowPhase = z.infer<typeof GameflowPhaseSchema>;

/** `/lol-gameflow/v1/gameflow-phase` → a JSON string. Unknown phases are kept as strings. */
export const GameflowPhaseResponseSchema = z.union([GameflowPhaseSchema, z.string()]);

export const LCU_ENDPOINTS = {
  gameflowPhase: '/lol-gameflow/v1/gameflow-phase',
  gameflowSession: '/lol-gameflow/v1/session',
  currentSummoner: '/lol-summoner/v1/current-summoner',
  eogStatsBlock: '/lol-end-of-game/v1/eog-stats-block',
} as const;

/** `/lol-gameflow/v1/session`, modelled loosely. */
export const GameflowSessionSchema = z.looseObject({
  phase: z.union([GameflowPhaseSchema, z.string()]),
  gameData: z
    .looseObject({
      gameId: z.number().optional(),
      queue: z
        .looseObject({
          id: z.number().optional(),
          gameMode: z.string().optional(),
          mapId: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  map: z.looseObject({ id: z.number().optional() }).optional(),
});
export type GameflowSession = z.output<typeof GameflowSessionSchema>;

/** `/lol-summoner/v1/current-summoner`, modelled loosely. */
export const CurrentSummonerSchema = z.looseObject({
  gameName: z.string(),
  tagLine: z.string(),
  puuid: z.string(),
  summonerId: z.number(),
});
export type CurrentSummoner = z.output<typeof CurrentSummonerSchema>;
