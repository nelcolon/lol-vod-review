/**
 * Deterministic fakes for tests (and for the desktop app's own tests): a virtual-time
 * scheduler and a clock driven by it. No real timers are involved.
 */

import type { Scheduler } from '../lifecycle/runner.js';
import type { HostClock } from '../livepoller/poller.js';

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

export class FakeScheduler implements Scheduler {
  private timers: Timer[] = [];
  private nextId = 1;
  /** Virtual milliseconds since start. */
  nowMs = 0;

  setTimeout(fn: () => void, ms: number): unknown {
    const t: Timer = { id: this.nextId++, at: this.nowMs + Math.max(0, ms), fn };
    this.timers.push(t);
    return t.id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  get pending(): number {
    return this.timers.length;
  }

  /** Advance virtual time, firing timers in order. */
  advance(ms: number): void {
    const target = this.nowMs + ms;
    for (;;) {
      const next = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.timers = this.timers.filter((t) => t.id !== next.id);
      this.nowMs = next.at;
      next.fn();
    }
    this.nowMs = target;
  }

  /** Advance virtual time asynchronously, letting promise callbacks run between timers. */
  async advanceAsync(ms: number, stepMs = 1): Promise<void> {
    const target = this.nowMs + ms;
    while (this.nowMs < target) {
      const step = Math.min(stepMs, target - this.nowMs);
      this.advance(step);
      await flushMicrotasks();
    }
  }
}

export class FakeClock implements HostClock {
  constructor(private readonly scheduler: FakeScheduler, private readonly originNs = 1_000_000_000_000n) {}
  /** Extra nanoseconds added to simulate request latency; tests may bump it. */
  skewNs = 0;
  hrtimeNs(): bigint {
    return this.originNs + BigInt(Math.round(this.scheduler.nowMs * 1e6)) + BigInt(this.skewNs);
  }
  nowMs(): number {
    return 1_700_000_000_000 + this.scheduler.nowMs;
  }
}

export async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
