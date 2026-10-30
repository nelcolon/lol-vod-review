import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Events of `lvr-recorder` (packages/recorder/README.md). */
export interface StartedEvent {
  ev: 'started';
  qpcStart: number;
  qpcFreq: number;
  wallStart: string;
  encoder: string;
  width: number;
  height: number;
  fps: number;
  path: string;
  hwnd?: number;
  /** `dxgi` (desktop duplication) or `wgc`; absent from recorders before 0.3.8. */
  captureMethod?: 'dxgi' | 'wgc';
}
export interface StoppedEvent {
  ev: 'stopped';
  durationMs: number;
  path: string;
  frames: number;
  dropped: number;
  reason: string;
}
export interface StatsEvent {
  ev: 'stats';
  frames: number;
  dropped: number;
  t: number;
  fpsActual: number;
}
export interface WarningEvent {
  ev: 'warning';
  code: string;
  detail?: string;
  t: number;
}
export interface ErrorEvent {
  ev: 'error';
  code: string;
  message: string;
}
type RecorderEvent = StartedEvent | StoppedEvent | StatsEvent | WarningEvent | ErrorEvent | { ev: string };

export interface StartOptions {
  target: { hwnd: number } | { processName: string };
  out: string;
  fps: number;
  bitrateMbps: number;
  /** Mix the default microphone into the game audio. */
  mic?: boolean;
  /** Mic gain in percent. */
  micVolume?: number;
  /** `auto` = DXGI desktop duplication, falling back to WGC. */
  capture?: 'auto' | 'wgc';
}

export interface RecorderHandlers {
  onStats(s: StatsEvent): void;
  onWarning(w: WarningEvent): void;
  /** The recorder stopped on its own (window closed, capture ended). */
  onSpontaneousStop(s: StoppedEvent): void;
  onExit(code: number | null): void;
}

/**
 * One long-lived `lvr-recorder.exe` child. `start()` resolves on `started` (or rejects on
 * `error`), `stop()` resolves on `stopped`. Closing stdin (app exit) makes the recorder
 * finalize the file on its own.
 */
export class RecorderSidecar {
  private child: ChildProcessWithoutNullStreams | null = null;
  private waiting: { kind: 'start' | 'stop'; resolve: (e: RecorderEvent) => void; reject: (e: Error) => void } | null = null;
  private recording = false;

  constructor(
    private readonly exePath: string,
    private readonly h: RecorderHandlers,
  ) {}

  get isRecording(): boolean {
    return this.recording;
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null) return this.child;
    const child = spawn(this.exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    createInterface({ input: child.stdout }).on('line', (line) => this.onLine(line));
    createInterface({ input: child.stderr }).on('line', (line) => console.log(`[recorder:stderr] ${line}`));
    child.on('exit', (code) => {
      this.child = null;
      this.recording = false;
      this.waiting?.reject(new Error(`recorder exited (${code})`));
      this.waiting = null;
      this.h.onExit(code);
    });
    child.on('error', (e) => {
      this.waiting?.reject(e);
      this.waiting = null;
    });
    return child;
  }

  private onLine(line: string): void {
    let ev: RecorderEvent;
    try {
      ev = JSON.parse(line) as RecorderEvent;
    } catch {
      console.warn(`[recorder] bad line: ${line}`);
      return;
    }
    switch (ev.ev) {
      case 'started':
        this.recording = true;
        if (this.waiting?.kind === 'start') this.settle(ev);
        break;
      case 'stopped':
        this.recording = false;
        if (this.waiting?.kind === 'stop') this.settle(ev);
        else this.h.onSpontaneousStop(ev as StoppedEvent);
        break;
      case 'error':
        console.warn(`[recorder] error ${(ev as ErrorEvent).code}: ${(ev as ErrorEvent).message}`);
        if (this.waiting) {
          const w = this.waiting;
          this.waiting = null;
          w.reject(Object.assign(new Error((ev as ErrorEvent).message), { code: (ev as ErrorEvent).code }));
        }
        break;
      case 'stats':
        this.h.onStats(ev as StatsEvent);
        break;
      case 'warning':
        this.h.onWarning(ev as WarningEvent);
        break;
      default:
        break;
    }
  }

  private settle(ev: RecorderEvent): void {
    const w = this.waiting;
    this.waiting = null;
    w?.resolve(ev);
  }

  private send(cmd: object, kind: 'start' | 'stop', timeoutMs: number): Promise<RecorderEvent> {
    const child = this.ensure();
    if (this.waiting) return Promise.reject(new Error(`recorder busy (${this.waiting.kind})`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiting?.kind === kind) this.waiting = null;
        reject(new Error(`recorder ${kind} timed out`));
      }, timeoutMs);
      this.waiting = {
        kind,
        resolve: (e) => {
          clearTimeout(timer);
          resolve(e);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      child.stdin.write(`${JSON.stringify(cmd)}\n`);
    });
  }

  async start(o: StartOptions): Promise<StartedEvent> {
    // `started` comes with the first frame; a static loading screen can take a moment.
    const ev = await this.send(
      { cmd: 'start', target: o.target, out: o.out, fps: o.fps, bitrateMbps: o.bitrateMbps, audio: { game: true, mic: o.mic ?? false, micVolume: o.micVolume ?? 100 }, capture: o.capture ?? 'auto' },
      'start',
      15_000,
    );
    return ev as StartedEvent;
  }

  async stop(): Promise<StoppedEvent | null> {
    if (!this.recording) return null;
    return (await this.send({ cmd: 'stop' }, 'stop', 30_000)) as StoppedEvent;
  }

  /** App shutdown: EOF on stdin finalizes any recording. */
  dispose(): void {
    this.child?.stdin.end();
  }
}
