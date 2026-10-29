import { describe, expect, it } from 'vitest';
import { ClockMapper, confidenceFor } from './mapper.js';

const ORIGIN = 5_000_000_000_000n; // host ns at gameTime 0 (QPC-like, arbitrary)
const S = 1e9;

/** Deterministic jitter in ±maxMs. */
function jitterNs(i: number, maxMs: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return Math.round((x - Math.floor(x) - 0.5) * 2 * maxMs * 1e6);
}

/** Feed samples at 2 Hz from gt=start to gt=end with host = ORIGIN + offsetS + gt (+jitter). */
function feed(m: ClockMapper, startS: number, endS: number, hostOffsetS: number, jitterMs = 0, slope = 1) {
  for (let gt = startS, i = 0; gt <= endS + 1e-9; gt += 0.5, i++) {
    const host = ORIGIN + BigInt(Math.round((hostOffsetS + gt * slope) * S + jitterNs(i + startS * 7, jitterMs)));
    m.addSample(gt, host);
  }
}

describe('ClockMapper', () => {
  it('maps exactly on a perfect line', () => {
    const m = new ClockMapper();
    feed(m, 0, 60, 0);
    expect(m.pieceCount).toBe(1);
    expect(m.toHostNs(30)).toBeCloseTo(Number(ORIGIN) + 30 * S, -2);
    expect(m.toHostNs(45.25)).toBeCloseTo(Number(ORIGIN) + 45.25 * S, -2);
    const st = m.stats();
    expect(st.pieces[0]!.slope / S).toBeCloseTo(1, 6);
    expect(st.pieces[0]!.residualRmsMs).toBeLessThan(0.001);
    expect(m.locate(30)!.confidence).toBeGreaterThan(0.99);
  });

  it('rejects jitter: ±15 ms request noise gives a fit within a few ms', () => {
    const m = new ClockMapper();
    feed(m, 0, 120, 0, 15);
    const err = Math.abs(m.toHostNs(60)! - (Number(ORIGIN) + 60 * S)) / 1e6;
    expect(err).toBeLessThan(5);
    const st = m.stats().pieces[0]!;
    expect(st.residualRmsMs).toBeLessThan(15);
    expect(st.residualMaxMs).toBeLessThan(20);
    expect(Math.abs(st.slope / S - 1)).toBeLessThan(0.001);
  });

  it('converts to video ms relative to a segment start', () => {
    const m = new ClockMapper();
    feed(m, 0, 30, 0);
    const segmentStart = ORIGIN - 2_500_000_000n; // recorder started 2.5 s before gameTime 0
    expect(m.toVideoMs(10, segmentStart)).toBeCloseTo(12_500, 3);
    expect(m.toVideoMs(0, Number(segmentStart))).toBeCloseTo(2_500, 3);
  });

  it('opens a new piece across a pause and maps both sides correctly', () => {
    const m = new ClockMapper();
    feed(m, 0, 300, 0); // 5 minutes
    // Pause: gameTime frozen at 300 for 30 s of host time (60 polls)
    for (let i = 1; i <= 60; i++) m.addSample(300, ORIGIN + BigInt((300 + i * 0.5) * S));
    // Resume: host is now 30 s ahead of gameTime
    feed(m, 300.5, 600, 30);

    expect(m.pieceCount).toBe(2);
    expect(m.stats().stalls).toBe(60);
    // Before the pause: original line
    expect(m.toHostNs(100)).toBeCloseTo(Number(ORIGIN) + 100 * S, -3);
    // After the pause: shifted by 30 s
    expect(m.toHostNs(400)).toBeCloseTo(Number(ORIGIN) + 430 * S, -3);
    // Event exactly at the pause boundary resolves to the containing piece (piece 1 ends at 300)
    expect(m.locate(300)!.pieceIndex).toBe(0);
    expect(m.locate(300.5)!.pieceIndex).toBe(1);
    // Inverse mapping follows the host ranges
    expect(m.toGameTime(ORIGIN + BigInt(430 * S))).toBeCloseTo(400, 3);
    expect(m.toGameTime(ORIGIN + BigInt(100 * S))).toBeCloseTo(100, 3);
  });

  it('keeps one piece across a sample gap when the clocks stay aligned (disconnect, server clock runs on)', () => {
    const m = new ClockMapper();
    feed(m, 0, 200, 0);
    // 40 s without any samples (2999 down), then it is back and aligned
    feed(m, 240, 400, 0);
    expect(m.pieceCount).toBe(1);
    // Events that happened during the gap still map via the same line
    expect(m.toHostNs(220)).toBeCloseTo(Number(ORIGIN) + 220 * S, -3);
    expect(m.locate(220)!.extrapolationS).toBe(0);
  });

  it('opens a new piece when gameTime jumps relative to the host (reconnect fast-forward)', () => {
    const m = new ClockMapper();
    feed(m, 0, 200, 0);
    // After the reconnect the client clock reports 2 s less than the host elapsed
    feed(m, 240, 400, 2);
    expect(m.pieceCount).toBe(2);
    expect(m.toHostNs(100)).toBeCloseTo(Number(ORIGIN) + 100 * S, -3);
    expect(m.toHostNs(300)).toBeCloseTo(Number(ORIGIN) + 302 * S, -3);
    // In the gap the nearest piece is used and extrapolation is reported
    const loc = m.locate(220)!;
    expect(loc.extrapolationS).toBe(20);
    expect(loc.confidence).toBeLessThan(m.locate(100)!.confidence);
  });

  it('ignores the loading-screen gameTime=0 stall and starts the fit when the clock runs', () => {
    const m = new ClockMapper();
    for (let i = 0; i < 20; i++) m.addSample(0, ORIGIN - BigInt(10 * S) + BigInt(i * 0.5 * S));
    feed(m, 0.5, 60, 0);
    expect(m.locate(30)!.pieceIndex).toBe(1);
    expect(m.toHostNs(30)).toBeCloseTo(Number(ORIGIN) + 30 * S, -3);
  });

  it('handles gameTime going backwards (chronobreak) as a new piece', () => {
    const m = new ClockMapper();
    feed(m, 0, 100, 0);
    // rollback to 80, then continue with host 20 s ahead
    feed(m, 80, 150, 20.5);
    expect(m.pieceCount).toBe(2);
    expect(m.locate(140)!.pieceIndex).toBe(1);
    expect(m.toHostNs(140)).toBeCloseTo(Number(ORIGIN) + 160.5 * S, -3);
  });

  it('returns undefined before any sample and accepts numeric host times', () => {
    const m = new ClockMapper();
    expect(m.toHostNs(1)).toBeUndefined();
    expect(m.toVideoMs(1, 0)).toBeUndefined();
    expect(m.toGameTime(1)).toBeUndefined();
    m.addSample(10, 1_000_000_000);
    expect(m.toHostNs(11)).toBeCloseTo(2_000_000_000, -1);
  });

  it('pins the slope to 1 until there are enough points, then fits it', () => {
    const m = new ClockMapper({ minPointsForSlope: 10 });
    feed(m, 0, 4, 0, 0, 1.01); // 9 points, slope 1.01 in the data
    expect(m.stats().pieces[0]!.slope / S).toBe(1);
    feed(m, 4.5, 20, 0, 0, 1.01);
    expect(m.stats().pieces[0]!.slope / S).toBeCloseTo(1.01, 4);
  });

  it('confidence degrades with few points, residual and extrapolation', () => {
    expect(confidenceFor(20, 0, 0)).toBe(1);
    expect(confidenceFor(5, 0, 0)).toBe(0.5);
    expect(confidenceFor(20, 50, 0)).toBeCloseTo(0.5);
    expect(confidenceFor(20, 0, 60)).toBeCloseTo(0.5);
  });
});
