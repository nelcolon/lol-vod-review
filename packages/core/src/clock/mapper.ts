/**
 * Clock mapping (PLAN §3.4): gameTime (seconds, from 2999) ⇄ host monotonic clock (ns,
 * QPC-like: `process.hrtime.bigint()` on the Windows host) ⇄ video time (ms into a segment).
 *
 * Every `/gamestats` poll yields one sample (gameTime, hostNs = midpoint of the request).
 * We fit `hostNs = a + b·gameTime` by least squares per *piece*; a new piece opens whenever
 * gameTime stops advancing (loading screen, pause, chronobreak) or jumps relative to the
 * host clock (reconnect fast-forward). `b ≈ 1` always; while a piece has few points the
 * slope is pinned to exactly 1 so early estimates are not thrown off by jitter.
 *
 * Video time of an event = (hostNs(EventTime) − segment.qpcStart) / 1e6.
 */

export interface ClockMapperOptions {
  /** gameTime advancing by less than this between polls counts as "not advancing". Default 0.001 s. */
  stallToleranceS: number;
  /** ...but only if the host clock advanced by at least this much (otherwise it's a duplicate poll). Default 0.1 s. */
  stallMinHostS: number;
  /** |Δhost − ΔgameTime| above this opens a new piece (reconnect jump, clock skew). Default 0.25 s. */
  jumpToleranceS: number;
  /** Below this many points the slope is pinned to 1. Default 10. */
  minPointsForSlope: number;
  /** Hard clamp on the fitted slope (sanity). Default [0.98, 1.02]. */
  slopeClamp: [number, number];
}

export const DEFAULT_CLOCK_MAPPER_OPTIONS: ClockMapperOptions = {
  stallToleranceS: 0.001,
  stallMinHostS: 0.1,
  jumpToleranceS: 0.25,
  minPointsForSlope: 10,
  slopeClamp: [0.98, 1.02],
};

interface Piece {
  index: number;
  /** Samples as [gameTimeS, hostNsRelativeToOrigin]. */
  samples: Array<[number, number]>;
  gtMin: number;
  gtMax: number;
  hostMin: number;
  hostMax: number;
  // offset-coordinate sums for the LS fit
  x0: number;
  y0: number;
  sx: number;
  sy: number;
  sxx: number;
  sxy: number;
  /** host = aRel + b·gt (host relative to origin) */
  aRel: number;
  b: number;
  residualCache: { rmsNs: number; maxAbsNs: number } | null;
}

export interface PieceStats {
  index: number;
  points: number;
  gameTimeStartS: number;
  gameTimeEndS: number;
  hostNsStart: number;
  hostNsEnd: number;
  /** Fitted slope (host seconds per game second). */
  slope: number;
  /** Fitted intercept: absolute hostNs at gameTime 0 (extrapolated). */
  interceptNs: number;
  residualRmsMs: number;
  residualMaxMs: number;
}

export interface Location {
  hostNs: number;
  pieceIndex: number;
  /** Seconds outside the piece's observed gameTime range (0 when interpolating). */
  extrapolationS: number;
  residualRmsMs: number;
  points: number;
  /** 0..1 — see `confidenceFor`. */
  confidence: number;
}

export interface MapperStats {
  samples: number;
  stalls: number;
  pieces: PieceStats[];
}

export class ClockMapper {
  readonly options: ClockMapperOptions;
  private originNs: bigint | null = null;
  private pieces: Piece[] = [];
  private last: { gt: number; host: number } | null = null;
  private inStall = false;
  private stallCount = 0;
  private sampleCount = 0;

  constructor(options: Partial<ClockMapperOptions> = {}) {
    this.options = { ...DEFAULT_CLOCK_MAPPER_OPTIONS, ...options };
  }

  /** Add one `/gamestats` sample. `hostNs` is the request midpoint on the host monotonic clock. */
  addSample(gameTimeS: number, hostNs: bigint | number): void {
    if (!Number.isFinite(gameTimeS)) return;
    const hostBig = typeof hostNs === 'bigint' ? hostNs : BigInt(Math.round(hostNs));
    if (this.originNs === null) this.originNs = hostBig;
    const host = Number(hostBig - this.originNs);
    this.sampleCount += 1;

    const last = this.last;
    this.last = { gt: gameTimeS, host };

    if (last === null) {
      this.openPiece(gameTimeS, host);
      return;
    }

    const dGt = gameTimeS - last.gt;
    const dHostS = (host - last.host) / 1e9;

    if (dGt <= this.options.stallToleranceS) {
      if (dHostS >= this.options.stallMinHostS || dGt < -this.options.stallToleranceS) {
        // gameTime stalled (pause, loading) or went backwards (chronobreak/reconnect)
        this.inStall = true;
        this.stallCount += 1;
      }
      // else: duplicate poll — ignore
      return;
    }

    if (this.inStall) {
      this.inStall = false;
      this.openPiece(gameTimeS, host);
      return;
    }

    if (Math.abs(dHostS - dGt) > this.options.jumpToleranceS) {
      this.openPiece(gameTimeS, host);
      return;
    }

    this.addToPiece(this.pieces[this.pieces.length - 1]!, gameTimeS, host);
  }

  get pieceCount(): number {
    return this.pieces.length;
  }

  get hasFit(): boolean {
    return this.pieces.length > 0;
  }

  /** Absolute host ns for a game time, or undefined when no samples exist. */
  toHostNs(gameTimeS: number): number | undefined {
    return this.locate(gameTimeS)?.hostNs;
  }

  /** Milliseconds into a video segment whose first frame has host timestamp `segmentStartNs`. */
  toVideoMs(gameTimeS: number, segmentStartNs: bigint | number): number | undefined {
    const host = this.toHostNs(gameTimeS);
    if (host === undefined) return undefined;
    const start = typeof segmentStartNs === 'bigint' ? Number(segmentStartNs) : segmentStartNs;
    return (host - start) / 1e6;
  }

  /** Inverse mapping: game time for an absolute host ns (nearest piece by host range). */
  toGameTime(hostNs: bigint | number): number | undefined {
    if (this.originNs === null || this.pieces.length === 0) return undefined;
    const host = Number((typeof hostNs === 'bigint' ? hostNs : BigInt(Math.round(hostNs))) - this.originNs);
    let best: Piece | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const p of this.pieces) {
      const dist = host < p.hostMin ? p.hostMin - host : host > p.hostMax ? host - p.hostMax : 0;
      if (dist < bestDist || (dist === bestDist && best !== undefined && p.samples.length > best.samples.length)) {
        best = p;
        bestDist = dist;
      }
    }
    if (!best) return undefined;
    return (host - best.aRel) / best.b;
  }

  /** Full location with confidence information. */
  locate(gameTimeS: number): Location | undefined {
    if (this.originNs === null || this.pieces.length === 0) return undefined;
    let best: Piece | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const p of this.pieces) {
      const dist = gameTimeS < p.gtMin ? p.gtMin - gameTimeS : gameTimeS > p.gtMax ? gameTimeS - p.gtMax : 0;
      // Prefer the containing piece; among equal distances prefer the one with more points.
      if (dist < bestDist || (dist === bestDist && best !== undefined && p.samples.length > best.samples.length)) {
        best = p;
        bestDist = dist;
      }
    }
    if (!best) return undefined;
    const hostRel = best.aRel + best.b * gameTimeS;
    const res = this.residuals(best);
    const rmsMs = res.rmsNs / 1e6;
    return {
      hostNs: Number(this.originNs) + hostRel,
      pieceIndex: best.index,
      extrapolationS: bestDist,
      residualRmsMs: rmsMs,
      points: best.samples.length,
      confidence: confidenceFor(best.samples.length, rmsMs, bestDist),
    };
  }

  stats(): MapperStats {
    const origin = this.originNs === null ? 0 : Number(this.originNs);
    return {
      samples: this.sampleCount,
      stalls: this.stallCount,
      pieces: this.pieces.map((p) => {
        const r = this.residuals(p);
        return {
          index: p.index,
          points: p.samples.length,
          gameTimeStartS: p.gtMin,
          gameTimeEndS: p.gtMax,
          hostNsStart: origin + p.hostMin,
          hostNsEnd: origin + p.hostMax,
          slope: p.b,
          interceptNs: origin + p.aRel,
          residualRmsMs: r.rmsNs / 1e6,
          residualMaxMs: r.maxAbsNs / 1e6,
        };
      }),
    };
  }

  // --- internals -----------------------------------------------------------------------

  private openPiece(gt: number, host: number): void {
    const piece: Piece = {
      index: this.pieces.length,
      samples: [],
      gtMin: gt,
      gtMax: gt,
      hostMin: host,
      hostMax: host,
      x0: gt,
      y0: host,
      sx: 0,
      sy: 0,
      sxx: 0,
      sxy: 0,
      aRel: host - gt * 1e9,
      b: 1e9,
      residualCache: null,
    };
    this.pieces.push(piece);
    this.addToPiece(piece, gt, host);
  }

  private addToPiece(p: Piece, gt: number, host: number): void {
    p.samples.push([gt, host]);
    p.gtMin = Math.min(p.gtMin, gt);
    p.gtMax = Math.max(p.gtMax, gt);
    p.hostMin = Math.min(p.hostMin, host);
    p.hostMax = Math.max(p.hostMax, host);
    const x = gt - p.x0;
    const y = (host - p.y0) / 1e9; // seconds, offset coordinates
    p.sx += x;
    p.sy += y;
    p.sxx += x * x;
    p.sxy += x * y;
    p.residualCache = null;
    this.refit(p);
  }

  private refit(p: Piece): void {
    const n = p.samples.length;
    let bS = 1; // host seconds per game second
    if (n >= this.options.minPointsForSlope) {
      const denom = n * p.sxx - p.sx * p.sx;
      if (denom > 1e-9) {
        bS = (n * p.sxy - p.sx * p.sy) / denom;
        const [lo, hi] = this.options.slopeClamp;
        bS = Math.min(hi, Math.max(lo, bS));
      }
    }
    const aS = (p.sy - bS * p.sx) / n; // offset-coordinate intercept (seconds)
    // host = y0 + (aS + bS·(gt − x0))·1e9
    p.b = bS * 1e9;
    p.aRel = p.y0 + (aS - bS * p.x0) * 1e9;
  }

  private residuals(p: Piece): { rmsNs: number; maxAbsNs: number } {
    if (p.residualCache) return p.residualCache;
    let sum = 0;
    let max = 0;
    for (const [gt, host] of p.samples) {
      const r = host - (p.aRel + p.b * gt);
      sum += r * r;
      max = Math.max(max, Math.abs(r));
    }
    const out = { rmsNs: p.samples.length ? Math.sqrt(sum / p.samples.length) : 0, maxAbsNs: max };
    p.residualCache = out;
    return out;
  }
}

/**
 * Confidence heuristic in 0..1: full marks need ≥10 points, RMS residual well under the
 * ±250 ms alignment target, and no extrapolation. Each factor degrades smoothly:
 *   points/10 (capped) × 1/(1 + rmsMs/50) × 1/(1 + extrapolationS/60)
 */
export function confidenceFor(points: number, residualRmsMs: number, extrapolationS: number): number {
  const pts = Math.min(1, points / 10);
  const res = 1 / (1 + Math.max(0, residualRmsMs) / 50);
  const ext = 1 / (1 + Math.max(0, extrapolationS) / 60);
  return Math.max(0, Math.min(1, pts * res * ext));
}
