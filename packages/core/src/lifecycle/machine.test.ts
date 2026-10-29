import { describe, expect, it } from 'vitest';
import { DEFAULT_RECORDING_SETTINGS } from './policy.js';
import { initialContext, reduce, type LifecycleContext, type LifecycleEffect, type LifecycleInput, type LifecycleOptions } from './machine.js';

function run(inputs: LifecycleInput[], options?: LifecycleOptions, start: LifecycleContext = initialContext()) {
  const effects: LifecycleEffect[] = [];
  const states: string[] = [start.state];
  let ctx = start;
  for (const input of inputs) {
    const r = reduce(ctx, input, options);
    ctx = r.ctx;
    effects.push(...r.effects);
    states.push(ctx.state);
  }
  return { ctx, effects, states };
}

const types = (effects: LifecycleEffect[]) => effects.map((e) => e.type);

const SR_UP: LifecycleInput = { type: 'liveClientUp', info: { gameMode: 'CLASSIC', mapId: 11 } };

describe('lifecycle reducer', () => {
  it('walks the happy path IDLE → ... → POST_PROCESS → CLIENT_UP', () => {
    const { ctx, effects, states } = run([
      { type: 'lockfileAppeared' },
      { type: 'gameflowPhase', phase: 'Lobby' },
      { type: 'gameflowPhase', phase: 'ChampSelect' },
      { type: 'gameflowPhase', phase: 'InProgress' },
      { type: 'queueInfo', info: { queueId: 420 } },
      SR_UP,
      { type: 'gameWindowFound', hwnd: 1, pid: 100 },
      { type: 'gameEnd', result: 'Win', gameTimeS: 1800 },
      { type: 'gameflowPhase', phase: 'WaitingForStats' },
      { type: 'postProcessDone' },
    ]);
    expect(states).toEqual([
      'IDLE',
      'CLIENT_UP',
      'CLIENT_UP',
      'CHAMP_SELECT',
      'LOADING',
      'LOADING',
      'LOADING',
      'RECORDING',
      'POST_PROCESS',
      'POST_PROCESS',
      'CLIENT_UP',
    ]);
    expect(types(effects)).toEqual(['startPolling', 'startRecording', 'stopRecording', 'stopPolling', 'runPostProcess']);
    const start = effects.find((e) => e.type === 'startRecording');
    expect(start).toMatchObject({ segmentIndex: 0, hwnd: 1, pid: 100 });
    const pp = effects.find((e) => e.type === 'runPostProcess');
    expect(pp).toMatchObject({ game: { result: 'Win', durationS: 1800, segments: 1, info: { queueId: 420, gameMode: 'CLASSIC', mapId: 11 } } });
    expect(ctx.segmentIndex).toBe(0);
    expect(ctx.lastGamePid).toBe(100);
  });

  it('returns to CLIENT_UP on a dodge and to IDLE when the client closes', () => {
    const a = run([{ type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'ChampSelect' }, { type: 'gameflowPhase', phase: 'Lobby' }]);
    expect(a.ctx.state).toBe('CLIENT_UP');
    const b = run([{ type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'ChampSelect' }, { type: 'lockfileVanished' }]);
    expect(b.ctx.state).toBe('IDLE');
  });

  it('waits for both the first 200 and the game window before recording', () => {
    const r1 = run([{ type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'InProgress' }, SR_UP]);
    expect(r1.ctx.state).toBe('LOADING');
    expect(types(r1.effects)).toEqual(['startPolling']);
    const r2 = run([{ type: 'gameWindowFound', hwnd: 7, pid: 9 }], undefined, r1.ctx);
    expect(r2.ctx.state).toBe('RECORDING');
    expect(types(r2.effects)).toEqual(['startRecording']);
  });

  it('can start without a window when requireGameWindow is false', () => {
    const opts: LifecycleOptions = { settings: DEFAULT_RECORDING_SETTINGS, requireGameWindow: false };
    const r = run([{ type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'InProgress' }, SR_UP], opts);
    expect(r.ctx.state).toBe('RECORDING');
    expect(types(r.effects)).toEqual(['startPolling', 'startRecording']);
  });

  it('skips disabled queues (Practice Tool) but still watches for the end', () => {
    const r = run([
      { type: 'lockfileAppeared' },
      { type: 'gameflowPhase', phase: 'InProgress' },
      { type: 'liveClientUp', info: { gameMode: 'PRACTICETOOL', mapId: 11 } },
      { type: 'gameWindowFound', hwnd: 1, pid: 2 },
      { type: 'gameEnd', result: 'Neither', gameTimeS: 600 },
    ]);
    expect(types(r.effects)).toEqual(['startPolling', 'skipGame', 'stopPolling']);
    expect(r.effects[1]).toMatchObject({ type: 'skipGame', reason: expect.stringContaining('Practice Tool') });
    expect(r.ctx.state).toBe('CLIENT_UP');
  });

  it('never records Brawl even if everything else is enabled', () => {
    const opts: LifecycleOptions = {
      settings: { ...DEFAULT_RECORDING_SETTINGS, arena: true, otherModes: true, custom: true, practiceTool: true },
      requireGameWindow: false,
    };
    const r = run([{ type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'InProgress' }, { type: 'liveClientUp', info: { gameMode: 'BRAWL', mapId: 35, queueId: 1300 } }], opts);
    expect(types(r.effects)).toEqual(['startPolling', 'skipGame']);
  });

  it('handles a reconnect with a new segment', () => {
    const base = run([{ type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'InProgress' }, SR_UP, { type: 'gameWindowFound', hwnd: 1, pid: 10 }]);
    expect(base.ctx.state).toBe('RECORDING');
    const r = run(
      [
        { type: 'gameWindowLost' },
        { type: 'liveClientLost' },
        { type: 'gameflowPhase', phase: 'Reconnect' },
        { type: 'gameflowPhase', phase: 'InProgress' },
        { type: 'liveClientUp' },
        { type: 'gameWindowFound', hwnd: 2, pid: 11 },
        { type: 'gameEnd', result: 'Lose', gameTimeS: 2000 },
      ],
      undefined,
      base.ctx,
    );
    expect(r.states).toEqual(['RECORDING', 'RECONNECTING', 'RECONNECTING', 'RECONNECTING', 'RECONNECTING', 'RECONNECTING', 'RECORDING', 'POST_PROCESS']);
    expect(types(r.effects)).toEqual(['stopRecording', 'startRecording', 'stopRecording', 'stopPolling', 'runPostProcess']);
    expect(r.effects[1]).toMatchObject({ type: 'startRecording', segmentIndex: 1, hwnd: 2, pid: 11 });
    expect(r.effects[4]).toMatchObject({ type: 'runPostProcess', game: { segments: 2 } });
  });

  it('treats gameflow=Reconnect while recording as a reconnect, and 2999 loss without it as game over', () => {
    const base = run([{ type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'InProgress' }, SR_UP, { type: 'gameWindowFound', hwnd: 1, pid: 10 }]);
    const a = run([{ type: 'gameflowPhase', phase: 'Reconnect' }], undefined, base.ctx);
    expect(a.ctx.state).toBe('RECONNECTING');
    expect(types(a.effects)).toEqual(['stopRecording']);

    const b = run([{ type: 'liveClientLost' }], undefined, base.ctx);
    expect(b.ctx.state).toBe('POST_PROCESS');
    expect(types(b.effects)).toEqual(['stopRecording', 'stopPolling', 'runPostProcess']);
    expect(b.effects[2]).toMatchObject({ game: { result: null } });
  });

  it('gives up on a reconnect after the timeout and post-processes what it has', () => {
    const base = run([{ type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'InProgress' }, SR_UP, { type: 'gameWindowFound' }, { type: 'gameflowPhase', phase: 'Reconnect' }]);
    const r = run([{ type: 'reconnectTimeout' }], undefined, base.ctx);
    expect(r.ctx.state).toBe('POST_PROCESS');
    expect(types(r.effects)).toEqual(['stopPolling', 'runPostProcess']);
  });

  it('discards remakes (< 4 min, Neither) unless pinned', () => {
    const setup: LifecycleInput[] = [{ type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'InProgress' }, SR_UP, { type: 'gameWindowFound' }];
    const remake = run([...setup, { type: 'gameEnd', result: 'Neither', gameTimeS: 180 }]);
    expect(types(remake.effects)).toEqual(['startPolling', 'startRecording', 'stopRecording', 'stopPolling', 'discardGame']);
    expect(remake.effects[4]).toMatchObject({ type: 'discardGame', reason: 'remake' });
    expect(remake.ctx.state).toBe('CLIENT_UP');

    const pinned = run([...setup, { type: 'pinGame' }, { type: 'gameEnd', result: 'Neither', gameTimeS: 180 }]);
    expect(types(pinned.effects)).toContain('runPostProcess');
    expect(pinned.ctx.state).toBe('POST_PROCESS');

    const surrender = run([...setup, { type: 'gameEnd', result: 'Lose', gameTimeS: 180 }]);
    expect(types(surrender.effects)).toContain('runPostProcess');
  });

  it('user pause stops the recorder and resume opens a new segment', () => {
    const base = run([{ type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'InProgress' }, SR_UP, { type: 'gameWindowFound' }]);
    const r = run([{ type: 'userPause', paused: true }, { type: 'userPause', paused: false }], undefined, base.ctx);
    expect(types(r.effects)).toEqual(['stopRecording', 'startRecording']);
    expect(r.effects[1]).toMatchObject({ segmentIndex: 1 });
    expect(r.ctx.state).toBe('RECORDING');
  });

  it('a game starting while paused is skipped, not recorded', () => {
    const r = run([{ type: 'userPause', paused: true }, { type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'InProgress' }, SR_UP, { type: 'gameWindowFound' }]);
    expect(types(r.effects)).toEqual(['startPolling', 'skipGame']);
    expect(r.effects[1]).toMatchObject({ reason: expect.stringContaining('paused') });
  });

  it('falls back to the game window when the LCU is closed, but ignores the finished game\'s window', () => {
    const r = run([{ type: 'gameWindowFound', hwnd: 1, pid: 50 }, SR_UP, { type: 'gameEnd', result: 'Win', gameTimeS: 1500 }, { type: 'postProcessDone' }]);
    expect(r.states).toEqual(['IDLE', 'LOADING', 'RECORDING', 'POST_PROCESS', 'IDLE']);
    const again = run([{ type: 'gameWindowFound', hwnd: 1, pid: 50 }], undefined, r.ctx);
    expect(again.ctx.state).toBe('IDLE');
    const fresh = run([{ type: 'gameWindowFound', hwnd: 2, pid: 51 }], undefined, r.ctx);
    expect(fresh.ctx.state).toBe('LOADING');
  });

  it('after post-processing, picks up a champ select that already started', () => {
    const r = run([
      { type: 'lockfileAppeared' },
      { type: 'gameflowPhase', phase: 'InProgress' },
      SR_UP,
      { type: 'gameWindowFound' },
      { type: 'gameEnd', result: 'Win', gameTimeS: 1500 },
      { type: 'gameflowPhase', phase: 'EndOfGame' },
      { type: 'gameflowPhase', phase: 'ChampSelect' },
      { type: 'postProcessDone' },
    ]);
    expect(r.ctx.state).toBe('CHAMP_SELECT');
  });

  it('ends the game on WaitingForStats if GameEnd never arrived', () => {
    const r = run([{ type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'InProgress' }, SR_UP, { type: 'gameWindowFound' }, { type: 'gameflowPhase', phase: 'WaitingForStats' }]);
    expect(r.ctx.state).toBe('POST_PROCESS');
  });

  it('leaves LOADING when the game fails to launch', () => {
    const r = run([{ type: 'lockfileAppeared' }, { type: 'gameflowPhase', phase: 'InProgress' }, { type: 'gameflowPhase', phase: 'FailedToLaunch' }]);
    expect(r.ctx.state).toBe('CLIENT_UP');
    expect(types(r.effects)).toEqual(['startPolling', 'stopPolling']);
  });

  it('does not mutate the previous context', () => {
    const start = initialContext();
    const snapshot = JSON.stringify(start);
    reduce(start, { type: 'lockfileAppeared' });
    reduce(start, { type: 'gameWindowFound', hwnd: 1, pid: 2 });
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});
