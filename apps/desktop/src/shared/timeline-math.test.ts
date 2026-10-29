import { describe, expect, it } from 'vitest';
import {
  clusterMarkers,
  formatGameTime,
  formatTime,
  frameStep,
  nextMomentIndex,
  prevMomentIndex,
  timeToPercent,
  timeToX,
  xToTime,
} from './timeline-math';

const g = { width: 1000, durationMs: 120_000 };

describe('timeToX / xToTime', () => {
  it('maps endpoints', () => {
    expect(timeToX(0, g)).toBe(0);
    expect(timeToX(120_000, g)).toBe(1000);
    expect(xToTime(0, g)).toBe(0);
    expect(xToTime(1000, g)).toBe(120_000);
  });
  it('maps linearly in between', () => {
    expect(timeToX(60_000, g)).toBe(500);
    expect(xToTime(250, g)).toBe(30_000);
  });
  it('clamps out-of-range values', () => {
    expect(timeToX(-5000, g)).toBe(0);
    expect(timeToX(999_999, g)).toBe(1000);
    expect(xToTime(-50, g)).toBe(0);
    expect(xToTime(5000, g)).toBe(120_000);
  });
  it('round-trips', () => {
    for (const t of [0, 1234, 59_999, 120_000]) {
      expect(xToTime(timeToX(t, g), g)).toBeCloseTo(t, 6);
    }
  });
  it('is safe with a zero-size geometry', () => {
    expect(timeToX(5000, { width: 0, durationMs: 0 })).toBe(0);
    expect(xToTime(5, { width: 0, durationMs: 0 })).toBe(0);
    expect(timeToPercent(10, 0)).toBe('0%');
  });
  it('produces CSS percentages', () => {
    expect(timeToPercent(30_000, 120_000)).toBe('25.0000%');
    expect(timeToPercent(240_000, 120_000)).toBe('100.0000%');
  });
});

describe('formatTime', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65_000)).toBe('1:05');
    expect(formatTime(3_725_000)).toBe('1:02:05');
    expect(formatTime(-10)).toBe('0:00');
  });
  it('adds tenths when asked', () => {
    expect(formatTime(65_430, true)).toBe('1:05.4');
  });
  it('formats game seconds', () => {
    expect(formatGameTime(702)).toBe('11:42');
  });
});

describe('clusterMarkers', () => {
  it('groups markers closer than minPx', () => {
    const ms = [100, 200, 5000, 60_000, 60_300].map((videoTMs) => ({ videoTMs }));
    const groups = clusterMarkers(ms, g, 6);
    expect(groups.map((grp) => grp.length)).toEqual([2, 1, 2]);
  });
  it('handles empty input', () => {
    expect(clusterMarkers([], g, 6)).toEqual([]);
  });
});

describe('moment navigation', () => {
  const starts = [10_000, 30_000, 50_000];
  it('finds next and previous with epsilon', () => {
    expect(nextMomentIndex(starts, 0)).toBe(0);
    expect(nextMomentIndex(starts, 10_000)).toBe(1);
    expect(nextMomentIndex(starts, 10_100)).toBe(1);
    expect(nextMomentIndex(starts, 50_000)).toBe(-1);
    expect(prevMomentIndex(starts, 50_000)).toBe(1);
    expect(prevMomentIndex(starts, 10_000)).toBe(-1);
    expect(prevMomentIndex(starts, 30_100)).toBe(0);
  });
});

describe('frameStep', () => {
  it('steps by one frame and clamps', () => {
    expect(frameStep(1000, 60, 1, 120_000)).toBeCloseTo(1000 + 1000 / 60, 6);
    expect(frameStep(5, 60, -1, 120_000)).toBe(0);
    expect(frameStep(119_995, 60, 1, 120_000)).toBe(120_000);
  });
});
