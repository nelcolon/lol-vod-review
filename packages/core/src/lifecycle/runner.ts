/**
 * Tiny driver around the pure reducer. It owns the two timers the reducer cannot:
 *  - "Live Client lost for N seconds" debounce (`liveOk()` / `liveFailed()` → `liveClientLost`)
 *  - reconnect timeout (RECONNECTING for too long → `reconnectTimeout`)
 * and it dedupes gameflow phases so repeated LCU polls do not re-trigger transitions.
 *
 * Effects are handed to `onEffect`; the runner never performs I/O itself.
 */

import {
  DEFAULT_LIFECYCLE_OPTIONS,
  initialContext,
  reduce,
  type GameflowPhase,
  type LifecycleContext,
  type LifecycleEffect,
  type LifecycleInput,
  type LifecycleOptions,
} from './machine.js';

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface LifecycleRunnerOptions extends Partial<LifecycleOptions> {
  scheduler?: Scheduler;
  /** Consecutive seconds without a 2999 response before `liveClientLost`. Default 8. */
  liveLostAfterS?: number;
  /** Give up on a reconnect after this long. Default 300 (5 min). */
  reconnectTimeoutS?: number;
  onEffect: (effect: LifecycleEffect, ctx: LifecycleContext) => void;
  onTransition?: (from: LifecycleContext, to: LifecycleContext, input: LifecycleInput) => void;
}

type LiveUpInfo = Extract<LifecycleInput, { type: 'liveClientUp' }>['info'];

export class LifecycleRunner {
  private ctx: LifecycleContext = initialContext();
  private readonly options: LifecycleOptions;
  private readonly scheduler: Scheduler;
  private readonly liveLostAfterMs: number;
  private readonly reconnectTimeoutMs: number;
  private liveLostTimer: unknown = null;
  private reconnectTimer: unknown = null;
  private lastPhase: GameflowPhase | null = null;

  constructor(private readonly opts: LifecycleRunnerOptions) {
    this.options = {
      settings: opts.settings ?? DEFAULT_LIFECYCLE_OPTIONS.settings,
      requireGameWindow: opts.requireGameWindow ?? DEFAULT_LIFECYCLE_OPTIONS.requireGameWindow,
    };
    this.scheduler = opts.scheduler ?? realScheduler;
    this.liveLostAfterMs = (opts.liveLostAfterS ?? 8) * 1000;
    this.reconnectTimeoutMs = (opts.reconnectTimeoutS ?? 300) * 1000;
  }

  get context(): LifecycleContext {
    return this.ctx;
  }

  get state(): LifecycleContext['state'] {
    return this.ctx.state;
  }

  /** Feed any input. Gameflow phases are deduped. */
  dispatch(input: LifecycleInput): LifecycleEffect[] {
    if (input.type === 'gameflowPhase') {
      if (input.phase === this.lastPhase) return [];
      this.lastPhase = input.phase;
    }
    const from = this.ctx;
    const { ctx, effects } = reduce(from, input, this.options);
    this.ctx = ctx;
    this.opts.onTransition?.(from, ctx, input);
    this.manageTimers(from, ctx);
    for (const e of effects) this.opts.onEffect(e, ctx);
    return effects;
  }

  /** The Live Client answered (first 200 or any later one). */
  liveOk(info?: LiveUpInfo): void {
    this.clearLiveLost();
    if (!this.ctx.liveUp) this.dispatchLiveUp(info);
  }

  /** A Live Client poll failed; after `liveLostAfterS` of failures → `liveClientLost`. */
  liveFailed(): void {
    if (!this.ctx.liveUp) return;
    if (this.liveLostTimer !== null) return;
    this.liveLostTimer = this.scheduler.setTimeout(() => {
      this.liveLostTimer = null;
      this.dispatch({ type: 'liveClientLost' });
    }, this.liveLostAfterMs);
  }

  /** Stop all timers (app shutdown). */
  dispose(): void {
    this.clearLiveLost();
    this.clearReconnect();
  }

  private dispatchLiveUp(info: LiveUpInfo): void {
    this.dispatch(info ? { type: 'liveClientUp', info } : { type: 'liveClientUp' });
  }

  private manageTimers(from: LifecycleContext, to: LifecycleContext): void {
    if (to.state === 'RECONNECTING' && from.state !== 'RECONNECTING') {
      this.clearReconnect();
      this.reconnectTimer = this.scheduler.setTimeout(() => {
        this.reconnectTimer = null;
        this.dispatch({ type: 'reconnectTimeout' });
      }, this.reconnectTimeoutMs);
    } else if (to.state !== 'RECONNECTING' && from.state === 'RECONNECTING') {
      this.clearReconnect();
    }
    if (!to.liveUp) this.clearLiveLost();
  }

  private clearLiveLost(): void {
    if (this.liveLostTimer !== null) {
      this.scheduler.clearTimeout(this.liveLostTimer);
      this.liveLostTimer = null;
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      this.scheduler.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
