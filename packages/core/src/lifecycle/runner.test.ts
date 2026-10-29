import { describe, expect, it } from 'vitest';
import { FakeScheduler } from '../testing/fakes.js';
import { LifecycleRunner } from './runner.js';
import type { LifecycleEffect } from './machine.js';

function makeRunner(opts: { liveLostAfterS?: number; reconnectTimeoutS?: number } = {}) {
  const scheduler = new FakeScheduler();
  const effects: LifecycleEffect[] = [];
  const runner = new LifecycleRunner({ scheduler, onEffect: (e) => effects.push(e), ...opts });
  return { scheduler, effects, runner };
}

function toRecording(runner: LifecycleRunner) {
  runner.dispatch({ type: 'lockfileAppeared' });
  runner.dispatch({ type: 'gameflowPhase', phase: 'InProgress' });
  runner.liveOk({ gameMode: 'CLASSIC', mapId: 11, queueId: 420 });
  runner.dispatch({ type: 'gameWindowFound', hwnd: 1, pid: 5 });
  expect(runner.state).toBe('RECORDING');
}

describe('LifecycleRunner', () => {
  it('dedupes repeated gameflow phases', () => {
    const { runner } = makeRunner();
    runner.dispatch({ type: 'lockfileAppeared' });
    expect(runner.dispatch({ type: 'gameflowPhase', phase: 'ChampSelect' })).toEqual([]);
    expect(runner.state).toBe('CHAMP_SELECT');
    runner.dispatch({ type: 'gameflowPhase', phase: 'InProgress' });
    expect(runner.state).toBe('LOADING');
    // A second InProgress poll must not re-enter LOADING (which would emit startPolling again).
    expect(runner.dispatch({ type: 'gameflowPhase', phase: 'InProgress' })).toEqual([]);
  });

  it('debounces Live Client loss and cancels it when a response arrives', () => {
    const { runner, scheduler } = makeRunner({ liveLostAfterS: 8 });
    toRecording(runner);
    runner.liveFailed();
    runner.liveFailed(); // second failure does not restart the timer
    scheduler.advance(7999);
    expect(runner.state).toBe('RECORDING');
    runner.liveOk();
    scheduler.advance(10_000);
    expect(runner.state).toBe('RECORDING');
    expect(scheduler.pending).toBe(0);
  });

  it('fires liveClientLost after N seconds of failures', () => {
    const { runner, scheduler, effects } = makeRunner({ liveLostAfterS: 8 });
    toRecording(runner);
    runner.liveFailed();
    scheduler.advance(8000);
    expect(runner.state).toBe('POST_PROCESS');
    expect(effects.map((e) => e.type)).toEqual(['startPolling', 'startRecording', 'stopRecording', 'stopPolling', 'runPostProcess']);
  });

  it('times out a reconnect', () => {
    const { runner, scheduler } = makeRunner({ reconnectTimeoutS: 300 });
    toRecording(runner);
    runner.dispatch({ type: 'gameflowPhase', phase: 'Reconnect' });
    expect(runner.state).toBe('RECONNECTING');
    scheduler.advance(299_000);
    expect(runner.state).toBe('RECONNECTING');
    scheduler.advance(1000);
    expect(runner.state).toBe('POST_PROCESS');
  });

  it('clears the reconnect timer when the game comes back', () => {
    const { runner, scheduler } = makeRunner({ reconnectTimeoutS: 10 });
    toRecording(runner);
    runner.dispatch({ type: 'gameWindowLost' });
    expect(runner.state).toBe('RECONNECTING');
    runner.dispatch({ type: 'gameWindowFound', hwnd: 2, pid: 6 });
    expect(runner.state).toBe('RECORDING');
    scheduler.advance(20_000);
    expect(runner.state).toBe('RECORDING');
    expect(scheduler.pending).toBe(0);
  });

  it('liveOk only dispatches liveClientUp once per up-period', () => {
    const { runner } = makeRunner();
    runner.dispatch({ type: 'lockfileAppeared' });
    runner.dispatch({ type: 'gameflowPhase', phase: 'InProgress' });
    const seen: string[] = [];
    const r2 = new LifecycleRunner({
      scheduler: new FakeScheduler(),
      onEffect: () => undefined,
      onTransition: (_f, _t, input) => seen.push(input.type),
    });
    r2.dispatch({ type: 'lockfileAppeared' });
    r2.dispatch({ type: 'gameflowPhase', phase: 'InProgress' });
    r2.liveOk();
    r2.liveOk();
    r2.liveOk();
    expect(seen.filter((t) => t === 'liveClientUp')).toHaveLength(1);
  });
});
