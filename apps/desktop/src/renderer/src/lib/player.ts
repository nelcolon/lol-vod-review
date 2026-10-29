/**
 * Thin controller around the bare <video> element. Keeps DOM access in one place so views
 * and the keyboard hook talk in milliseconds.
 */
import { clamp } from '@shared/timeline-math';

class Player {
  private el: HTMLVideoElement | null = null;

  attach(el: HTMLVideoElement | null): void {
    this.el = el;
  }

  get element(): HTMLVideoElement | null {
    return this.el;
  }

  get currentMs(): number {
    return this.el ? this.el.currentTime * 1000 : 0;
  }

  get durationMs(): number {
    const d = this.el?.duration;
    return d && Number.isFinite(d) ? d * 1000 : 0;
  }

  seek(ms: number): void {
    if (!this.el) return;
    const max = this.durationMs || Number.POSITIVE_INFINITY;
    this.el.currentTime = clamp(ms, 0, max) / 1000;
  }

  skip(deltaMs: number): void {
    this.seek(this.currentMs + deltaMs);
  }

  play(): void {
    void this.el?.play().catch(() => undefined);
  }

  pause(): void {
    this.el?.pause();
  }

  toggle(): void {
    if (!this.el) return;
    if (this.el.paused) this.play();
    else this.pause();
  }

  /** Mute is remembered across games and restarts (a per-viewer preference). */
  get muted(): boolean {
    try {
      return localStorage.getItem('lvr.muted') === '1';
    } catch {
      return false;
    }
  }

  setMuted(muted: boolean): void {
    if (this.el) this.el.muted = muted;
    try {
      localStorage.setItem('lvr.muted', muted ? '1' : '0');
    } catch {
      /* storage unavailable: mute still applies to this video */
    }
  }

  toggleMute(): void {
    this.setMuted(!(this.el?.muted ?? this.muted));
  }

  setRate(rate: number): void {
    if (this.el) this.el.playbackRate = rate;
  }

  /** Pause and move exactly one frame. Chromium seeks frame-accurately on `currentTime`. */
  stepFrame(dir: 1 | -1, fps: number): void {
    if (!this.el) return;
    this.el.pause();
    const frame = 1000 / (fps > 0 ? fps : 60);
    // nudge by half a frame past the boundary so we land inside the next frame, not on its edge
    this.seek(this.currentMs + dir * frame + dir * 0.5);
  }
}

export const player = new Player();
