/**
 * Pure time <-> pixel math for the marker timeline. Kept free of DOM so it is unit-testable.
 */

export interface TimelineGeometry {
  /** Pixel width of the bar's inner track. */
  width: number;
  /** Total duration of the video in ms. */
  durationMs: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Video time (ms) -> x offset in px from the left edge of the track. */
export function timeToX(tMs: number, g: TimelineGeometry): number {
  if (g.durationMs <= 0 || g.width <= 0) return 0;
  return clamp(tMs / g.durationMs, 0, 1) * g.width;
}

/** x offset in px -> video time (ms), clamped to [0, duration]. */
export function xToTime(x: number, g: TimelineGeometry): number {
  if (g.durationMs <= 0 || g.width <= 0) return 0;
  return clamp(x / g.width, 0, 1) * g.durationMs;
}

/** Position as a percentage string for CSS `left`. */
export function timeToPercent(tMs: number, durationMs: number): string {
  if (durationMs <= 0) return '0%';
  return `${(clamp(tMs / durationMs, 0, 1) * 100).toFixed(4)}%`;
}

/** Format ms as m:ss or h:mm:ss. */
export function formatTime(ms: number, withTenths = false): string {
  const total = Math.max(0, ms) / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const tenths = Math.floor((total * 10) % 10);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const base = `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
  return withTenths ? `${base}.${tenths}` : base;
}

/** Format game seconds as m:ss (Live Client clock). */
export function formatGameTime(gameTimeS: number): string {
  return formatTime(gameTimeS * 1000);
}

/**
 * Group markers that would overlap visually (closer than `minPx`) so the timeline can draw a
 * stacked badge instead of unreadable overlapping ticks. Input must be sorted by time.
 */
export function clusterMarkers<T extends { videoTMs: number }>(
  markers: readonly T[],
  g: TimelineGeometry,
  minPx: number,
): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let lastX = -Infinity;
  for (const m of markers) {
    const x = timeToX(m.videoTMs, g);
    if (current.length > 0 && x - lastX < minPx) {
      current.push(m);
    } else {
      if (current.length) groups.push(current);
      current = [m];
    }
    lastX = x;
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Index of the next moment strictly after `tMs` (by window start), or -1. */
export function nextMomentIndex(starts: readonly number[], tMs: number, epsilonMs = 250): number {
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    if (s !== undefined && s > tMs + epsilonMs) return i;
  }
  return -1;
}

/** Index of the previous moment strictly before `tMs` (by window start), or -1. */
export function prevMomentIndex(starts: readonly number[], tMs: number, epsilonMs = 250): number {
  for (let i = starts.length - 1; i >= 0; i--) {
    const s = starts[i];
    if (s !== undefined && s < tMs - epsilonMs) return i;
  }
  return -1;
}

/** Step one frame at the given fps; `dir` is +1 or -1. */
export function frameStep(tMs: number, fps: number, dir: 1 | -1, durationMs: number): number {
  const frame = 1000 / (fps > 0 ? fps : 60);
  return clamp(tMs + dir * frame, 0, durationMs);
}
