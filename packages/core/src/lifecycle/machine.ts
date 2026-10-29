/**
 * Game lifecycle state machine (PLAN §3.3) as a pure reducer.
 *
 *   IDLE → CLIENT_UP → CHAMP_SELECT → LOADING → RECORDING ⇄ RECONNECTING → POST_PROCESS → (CLIENT_UP|IDLE)
 *
 * `reduce(ctx, input)` returns the next context plus a list of effects. It never performs
 * I/O; the host (Electron main / `LifecycleRunner`) executes the effects.
 *
 * Signals: LCU `gameflow-phase` is primary, port 2999 (Live Client) is the confirmation and
 * the event source, the game window (HWND) is what the recorder captures and the fallback
 * detector when the LCU is closed.
 */

import { DEFAULT_RECORDING_SETTINGS, postGameDecision, shouldRecord, type GameInfo, type RecordingSettings } from './policy.js';

export type LifecycleState =
  | 'IDLE'
  | 'CLIENT_UP'
  | 'CHAMP_SELECT'
  | 'LOADING'
  | 'RECORDING'
  | 'RECONNECTING'
  | 'POST_PROCESS';

/** LCU `/lol-gameflow/v1/gameflow-phase` values (LCU 16.21). */
export type GameflowPhase =
  | 'None'
  | 'Lobby'
  | 'Matchmaking'
  | 'CheckedIntoTournament'
  | 'ReadyCheck'
  | 'ChampSelect'
  | 'GameStart'
  | 'FailedToLaunch'
  | 'InProgress'
  | 'Reconnect'
  | 'WaitingForStats'
  | 'PreEndOfGame'
  | 'EndOfGame'
  | 'TerminatedInError'
  | (string & {});

export type LifecycleInput =
  | { type: 'lockfileAppeared' }
  | { type: 'lockfileVanished' }
  | { type: 'gameflowPhase'; phase: GameflowPhase }
  /** First HTTP 200 from 2999 (`/gamestats`), with whatever we know about the game. */
  | { type: 'liveClientUp'; info?: Partial<GameInfo> }
  /** 2999 has not answered for N seconds (the runner debounces). */
  | { type: 'liveClientLost' }
  | { type: 'gameWindowFound'; hwnd?: number; pid?: number }
  | { type: 'gameWindowLost' }
  /** LCU session told us the queue (may arrive before or after liveClientUp). */
  | { type: 'queueInfo'; info: Partial<GameInfo> }
  | { type: 'gameEnd'; result: string; gameTimeS: number }
  | { type: 'postProcessDone' }
  | { type: 'reconnectTimeout' }
  | { type: 'userPause'; paused: boolean }
  /** User pinned the current game (keeps it even if it turns out to be a remake). */
  | { type: 'pinGame' };

export type LifecycleEffect =
  | { type: 'startPolling' }
  | { type: 'stopPolling' }
  | { type: 'startRecording'; segmentIndex: number; hwnd: number | null; pid: number | null }
  | { type: 'stopRecording' }
  | { type: 'runPostProcess'; game: GameSummary }
  | { type: 'discardGame'; reason: string; game: GameSummary }
  /** The game is being watched for GameEnd but not recorded (queue disabled, user paused). */
  | { type: 'skipGame'; reason: string; info: GameInfo };

export interface GameSummary {
  info: GameInfo;
  /** Number of segments started (0 when nothing was recorded). */
  segments: number;
  result: string | null;
  durationS: number | null;
  pinned: boolean;
}

export interface LifecycleContext {
  state: LifecycleState;
  lockfile: boolean;
  gameflow: GameflowPhase | null;
  liveUp: boolean;
  window: { found: boolean; hwnd: number | null; pid: number | null };
  paused: boolean;
  pinned: boolean;
  /** Index of the next segment to start; equals number of segments started so far. */
  segmentIndex: number;
  /** True while the recorder sidecar is (supposed to be) running. */
  recorderActive: boolean;
  /** False when the queue policy said skip for this game. */
  recordingEnabled: boolean;
  info: GameInfo;
  result: string | null;
  durationS: number | null;
  /**
   * PID of the game process of the last finished game. A `gameWindowFound` for the same PID
   * (the end-of-game screen still open) must not start a new game via the window fallback.
   */
  lastGamePid: number | null;
  /**
   * Set when a game finishes, cleared once the LCU leaves the in-game phases (or the client
   * closes). Until then the still-open game (Practice Tool victory screen, end-of-game
   * screen with 2999 still answering) must not start a new game.
   */
  gameOver: boolean;
}

export interface LifecycleOptions {
  settings: RecordingSettings;
  /** Require the game window before starting a segment (the recorder needs an HWND). Default true. */
  requireGameWindow: boolean;
}

export const DEFAULT_LIFECYCLE_OPTIONS: LifecycleOptions = {
  settings: DEFAULT_RECORDING_SETTINGS,
  requireGameWindow: true,
};

const EMPTY_INFO: GameInfo = { queueId: null, gameMode: null, mapId: null };

export function initialContext(): LifecycleContext {
  return {
    state: 'IDLE',
    lockfile: false,
    gameflow: null,
    liveUp: false,
    window: { found: false, hwnd: null, pid: null },
    paused: false,
    pinned: false,
    segmentIndex: 0,
    recorderActive: false,
    recordingEnabled: true,
    info: { ...EMPTY_INFO },
    result: null,
    durationS: null,
    lastGamePid: null,
    gameOver: false,
  };
}

export interface ReduceResult {
  ctx: LifecycleContext;
  effects: LifecycleEffect[];
}

const IN_GAME_PHASES: ReadonlySet<string> = new Set(['GameStart', 'InProgress', 'Reconnect']);
const GAME_OVER_PHASES: ReadonlySet<string> = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame', 'TerminatedInError']);
const LOBBY_PHASES: ReadonlySet<string> = new Set(['None', 'Lobby', 'Matchmaking', 'CheckedIntoTournament', 'ReadyCheck', 'FailedToLaunch']);

export function reduce(prev: LifecycleContext, input: LifecycleInput, options: LifecycleOptions = DEFAULT_LIFECYCLE_OPTIONS): ReduceResult {
  const ctx: LifecycleContext = { ...prev, window: { ...prev.window }, info: { ...prev.info } };
  const effects: LifecycleEffect[] = [];

  // --- Context updates that apply in every state -------------------------------------
  switch (input.type) {
    case 'lockfileAppeared':
      ctx.lockfile = true;
      break;
    case 'lockfileVanished':
      ctx.lockfile = false;
      ctx.gameOver = false;
      break;
    case 'gameflowPhase':
      ctx.gameflow = input.phase;
      if (!IN_GAME_PHASES.has(input.phase)) ctx.gameOver = false;
      break;
    case 'liveClientUp':
      if (ctx.gameOver) break; // the finished game's 2999, not a new game
      ctx.liveUp = true;
      if (input.info) mergeInfo(ctx, input.info);
      break;
    case 'liveClientLost':
      ctx.liveUp = false;
      break;
    case 'gameWindowFound':
      ctx.window = { found: true, hwnd: input.hwnd ?? null, pid: input.pid ?? null };
      break;
    case 'gameWindowLost':
      ctx.window = { found: false, hwnd: null, pid: null };
      break;
    case 'queueInfo':
      mergeInfo(ctx, input.info);
      break;
    case 'userPause':
      ctx.paused = input.paused;
      break;
    case 'pinGame':
      ctx.pinned = true;
      break;
    default:
      break;
  }

  // --- State transitions -------------------------------------------------------------
  switch (prev.state) {
    case 'IDLE':
      if (input.type === 'lockfileAppeared') ctx.state = 'CLIENT_UP';
      else if (input.type === 'gameflowPhase') applyPhaseOutsideGame(ctx, effects, options);
      else if (startsGameFromOutside(ctx, input)) enterLoading(ctx, effects, options);
      break;

    case 'CLIENT_UP':
      if (input.type === 'lockfileVanished') ctx.state = 'IDLE';
      else if (input.type === 'gameflowPhase') applyPhaseOutsideGame(ctx, effects, options);
      else if (startsGameFromOutside(ctx, input)) enterLoading(ctx, effects, options);
      break;

    case 'CHAMP_SELECT':
      if (input.type === 'lockfileVanished') ctx.state = 'IDLE';
      else if (input.type === 'gameflowPhase') applyPhaseOutsideGame(ctx, effects, options);
      else if (startsGameFromOutside(ctx, input)) enterLoading(ctx, effects, options);
      break;

    case 'LOADING':
      if (input.type === 'gameflowPhase' && (LOBBY_PHASES.has(input.phase) || GAME_OVER_PHASES.has(input.phase))) {
        // Game never started (dodge, FailedToLaunch) or ended before 2999 came up.
        effects.push({ type: 'stopPolling' });
        resetGame(ctx);
        ctx.state = ctx.lockfile ? 'CLIENT_UP' : 'IDLE';
      } else if (input.type === 'gameflowPhase' && input.phase === 'ChampSelect') {
        effects.push({ type: 'stopPolling' });
        resetGame(ctx);
        ctx.state = 'CHAMP_SELECT';
      } else if (
        input.type === 'liveClientUp' ||
        input.type === 'gameWindowFound' ||
        input.type === 'queueInfo' ||
        input.type === 'userPause'
      ) {
        tryStartRecording(ctx, effects, options);
      }
      // liveClientLost while LOADING (crash on load): stay; the LCU reports Reconnect or a lobby phase.
      break;

    case 'RECORDING':
      if (input.type === 'gameEnd') {
        ctx.result = input.result;
        ctx.durationS = input.gameTimeS;
        finishGame(ctx, effects);
      } else if (input.type === 'liveClientLost') {
        if (ctx.gameflow === 'Reconnect' || !ctx.window.found) enterReconnecting(ctx, effects);
        else finishGame(ctx, effects);
      } else if (input.type === 'gameflowPhase' && input.phase === 'Reconnect') {
        enterReconnecting(ctx, effects);
      } else if (input.type === 'gameWindowLost') {
        enterReconnecting(ctx, effects);
      } else if (input.type === 'gameflowPhase' && (GAME_OVER_PHASES.has(input.phase) || LOBBY_PHASES.has(input.phase))) {
        // Leaving Practice Tool goes InProgress → None with no GameEnd and no end screen.
        finishGame(ctx, effects);
      } else if (input.type === 'userPause') {
        if (input.paused && ctx.recorderActive) {
          effects.push({ type: 'stopRecording' });
          ctx.recorderActive = false;
        } else if (!input.paused && !ctx.recorderActive && ctx.recordingEnabled) {
          startSegment(ctx, effects);
        }
      }
      break;

    case 'RECONNECTING':
      if (input.type === 'gameEnd') {
        ctx.result = input.result;
        ctx.durationS = input.gameTimeS;
        finishGame(ctx, effects);
      } else if (input.type === 'gameflowPhase' && (GAME_OVER_PHASES.has(input.phase) || LOBBY_PHASES.has(input.phase))) {
        finishGame(ctx, effects);
      } else if (input.type === 'reconnectTimeout') {
        finishGame(ctx, effects);
      } else if (input.type === 'liveClientUp' || input.type === 'gameWindowFound' || input.type === 'userPause') {
        if (ctx.liveUp && (ctx.window.found || !options.requireGameWindow)) {
          ctx.state = 'RECORDING';
          if (ctx.recordingEnabled && !ctx.paused) startSegment(ctx, effects);
        }
      }
      break;

    case 'POST_PROCESS':
      if (input.type === 'postProcessDone') {
        resetGame(ctx);
        ctx.state = ctx.lockfile ? 'CLIENT_UP' : 'IDLE';
        // The player may already be in the next champ select / game.
        if (ctx.gameflow === 'ChampSelect') ctx.state = 'CHAMP_SELECT';
        else if (ctx.gameflow !== null && IN_GAME_PHASES.has(ctx.gameflow) && !ctx.gameOver) enterLoading(ctx, effects, options);
      }
      break;
  }

  return { ctx, effects };
}

// --- helpers ------------------------------------------------------------------------

/**
 * Fallback detection when the LCU gave us no in-game phase: the Live Client answered or the
 * game window appeared. A window with the PID of the game that just finished is ignored.
 */
function startsGameFromOutside(ctx: LifecycleContext, input: LifecycleInput): boolean {
  if (ctx.gameOver) return false;
  if (input.type === 'liveClientUp') return true;
  if (input.type === 'gameWindowFound') {
    if (ctx.lastGamePid !== null && (input.pid === undefined || input.pid === ctx.lastGamePid)) return false;
    return true;
  }
  return false;
}

function mergeInfo(ctx: LifecycleContext, info: Partial<GameInfo>): void {
  if (info.queueId !== undefined) ctx.info.queueId = info.queueId;
  if (info.gameMode !== undefined) ctx.info.gameMode = info.gameMode;
  if (info.mapId !== undefined) ctx.info.mapId = info.mapId;
  if (info.spectator !== undefined) ctx.info.spectator = info.spectator;
}

function applyPhaseOutsideGame(ctx: LifecycleContext, effects: LifecycleEffect[], options: LifecycleOptions): void {
  const phase = ctx.gameflow;
  if (phase === null) return;
  if (phase === 'ChampSelect') ctx.state = 'CHAMP_SELECT';
  else if (IN_GAME_PHASES.has(phase)) {
    if (!ctx.gameOver) enterLoading(ctx, effects, options);
  } else if (LOBBY_PHASES.has(phase) || GAME_OVER_PHASES.has(phase)) ctx.state = ctx.lockfile ? 'CLIENT_UP' : 'IDLE';
}

function enterLoading(ctx: LifecycleContext, effects: LifecycleEffect[], options: LifecycleOptions): void {
  ctx.state = 'LOADING';
  ctx.lastGamePid = null;
  ctx.segmentIndex = 0;
  ctx.recorderActive = false;
  ctx.recordingEnabled = true;
  ctx.pinned = false;
  ctx.result = null;
  ctx.durationS = null;
  effects.push({ type: 'startPolling' });
  tryStartRecording(ctx, effects, options);
}

function tryStartRecording(ctx: LifecycleContext, effects: LifecycleEffect[], options: LifecycleOptions): void {
  if (ctx.state !== 'LOADING') return;
  if (!ctx.liveUp) return;
  if (options.requireGameWindow && !ctx.window.found) return;

  const decision = shouldRecord(ctx.info.queueId, ctx.info.gameMode, ctx.info.mapId, options.settings, ctx.info.spectator ?? false);
  ctx.state = 'RECORDING';
  if (!decision.record) {
    ctx.recordingEnabled = false;
    effects.push({ type: 'skipGame', reason: decision.reason, info: { ...ctx.info } });
    return;
  }
  if (ctx.paused) {
    effects.push({ type: 'skipGame', reason: 'user paused recording', info: { ...ctx.info } });
    return;
  }
  startSegment(ctx, effects);
}

function startSegment(ctx: LifecycleContext, effects: LifecycleEffect[]): void {
  effects.push({ type: 'startRecording', segmentIndex: ctx.segmentIndex, hwnd: ctx.window.hwnd, pid: ctx.window.pid });
  ctx.segmentIndex += 1;
  ctx.recorderActive = true;
}

function enterReconnecting(ctx: LifecycleContext, effects: LifecycleEffect[]): void {
  if (ctx.recorderActive) {
    effects.push({ type: 'stopRecording' });
    ctx.recorderActive = false;
  }
  ctx.state = 'RECONNECTING';
}

function summary(ctx: LifecycleContext): GameSummary {
  return { info: { ...ctx.info }, segments: ctx.segmentIndex, result: ctx.result, durationS: ctx.durationS, pinned: ctx.pinned };
}

function finishGame(ctx: LifecycleContext, effects: LifecycleEffect[]): void {
  if (ctx.recorderActive) {
    effects.push({ type: 'stopRecording' });
    ctx.recorderActive = false;
  }
  effects.push({ type: 'stopPolling' });
  const game = summary(ctx);
  ctx.lastGamePid = ctx.window.pid;
  ctx.gameOver = ctx.gameflow !== null && IN_GAME_PHASES.has(ctx.gameflow);

  if (!ctx.recordingEnabled || ctx.segmentIndex === 0) {
    // Nothing recorded: nothing to post-process.
    resetGame(ctx);
    ctx.state = ctx.lockfile ? 'CLIENT_UP' : 'IDLE';
    return;
  }

  const decision = postGameDecision({ durationS: ctx.durationS ?? Number.POSITIVE_INFINITY, result: ctx.result, pinned: ctx.pinned });
  if (!decision.keep) {
    effects.push({ type: 'discardGame', reason: decision.reason, game });
    resetGame(ctx);
    ctx.state = ctx.lockfile ? 'CLIENT_UP' : 'IDLE';
    return;
  }

  ctx.state = 'POST_PROCESS';
  effects.push({ type: 'runPostProcess', game });
}

function resetGame(ctx: LifecycleContext): void {
  ctx.liveUp = false;
  ctx.window = { found: false, hwnd: null, pid: null };
  ctx.segmentIndex = 0;
  ctx.recorderActive = false;
  ctx.recordingEnabled = true;
  ctx.pinned = false;
  ctx.info = { ...EMPTY_INFO };
  ctx.result = null;
  ctx.durationS = null;
}
