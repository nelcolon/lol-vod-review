/**
 * Moments engine v1 configuration (PLAN §3.6). All weights live here so the desktop app can
 * expose them in settings and tests can pin them.
 *
 *   score = w1·self_involvement + w2·stakes + w3·participants + w4·phase + w5·death_cost
 *
 * Each component is in 0..1 and the weights sum to 1, so `score` is in 0..1.
 */

export interface MomentsWeights {
  /** w1 — victim 1.0 / killer 0.6 / assister 0.4 / team-only event 0.1 (see `involvement`). */
  selfInvolvement: number;
  /** w2 — what was on the line (see `stakes`). */
  stakes: number;
  /** w3 — how many champions were involved (unique names / 10, teamfight ≥ 0.6). */
  participants: number;
  /** w4 — own deaths before 14:00 boosted (laners). */
  phase: number;
  /** w5 — respawn timer at death plus "traded into an enemy objective". */
  deathCost: number;
}

export interface InvolvementWeights {
  death: number;
  kill: number;
  assist: number;
  /** Trigger event (objective, ace...) the player did not touch. */
  teamEvent: number;
}

export interface StakesWeights {
  elder: number;
  baron: number;
  /** The drake that completes a Soul, or any drake taken while either team is at 3 (soul point). */
  soulDrake: number;
  drake: number;
  herald: number;
  grubs: number;
  atakhan: number;
  firstTower: number;
  tower: number;
  inhibitor: number;
  ace: number;
  /** Multikill = base + perExtra·(streak − 2). */
  multikillBase: number;
  multikillPerExtra: number;
  /** A champion kill with nothing else around it. */
  kill: number;
  /** Added when an epic monster was `Stolen` (capped at 1). */
  stolenBonus: number;
}

export interface MomentsConfig {
  /** Seconds of video before the trigger. Default 10, clamped to 5..90. */
  preRollS: number;
  /** Seconds after the last event of the cluster. Default 10. */
  postRollS: number;
  /** Events closer than this (seconds) merge into one moment. Default 15. */
  clusterGapS: number;
  /** ≥ this many champion kills within `teamfightWindowS` → teamfight. Default 3 / 15 s. */
  teamfightKills: number;
  teamfightWindowS: number;
  /** An enemy objective within ± this many seconds of an own death = "traded into objective". Default 60. */
  objectiveTradeWindowS: number;
  /** Lane phase boundary for the phase boost. Default 14:00. */
  lanePhaseEndS: number;
  /** The player is a laner (phase boost applies fully). Default true. */
  laner: boolean;
  weights: MomentsWeights;
  involvement: InvolvementWeights;
  stakes: StakesWeights;
}

export const DEFAULT_MOMENTS_CONFIG: MomentsConfig = {
  preRollS: 10,
  postRollS: 10,
  clusterGapS: 15,
  teamfightKills: 3,
  teamfightWindowS: 15,
  objectiveTradeWindowS: 60,
  lanePhaseEndS: 14 * 60,
  laner: true,
  weights: {
    selfInvolvement: 0.4,
    stakes: 0.25,
    participants: 0.1,
    phase: 0.1,
    deathCost: 0.15,
  },
  involvement: {
    death: 1.0,
    kill: 0.6,
    assist: 0.4,
    teamEvent: 0.1,
  },
  stakes: {
    elder: 1.0,
    baron: 1.0,
    soulDrake: 0.85,
    drake: 0.5,
    herald: 0.5,
    grubs: 0.4,
    atakhan: 0.5,
    firstTower: 0.6,
    tower: 0.4,
    inhibitor: 0.6,
    ace: 0.5,
    multikillBase: 0.3,
    multikillPerExtra: 0.1,
    kill: 0.2,
    stolenBonus: 0.25,
  },
};

export const PRE_ROLL_MIN_S = 5;
export const PRE_ROLL_MAX_S = 90;

export function resolveMomentsConfig(partial: Partial<MomentsConfig> = {}): MomentsConfig {
  const cfg: MomentsConfig = {
    ...DEFAULT_MOMENTS_CONFIG,
    ...partial,
    weights: { ...DEFAULT_MOMENTS_CONFIG.weights, ...(partial.weights ?? {}) },
    involvement: { ...DEFAULT_MOMENTS_CONFIG.involvement, ...(partial.involvement ?? {}) },
    stakes: { ...DEFAULT_MOMENTS_CONFIG.stakes, ...(partial.stakes ?? {}) },
  };
  cfg.preRollS = Math.min(PRE_ROLL_MAX_S, Math.max(PRE_ROLL_MIN_S, cfg.preRollS));
  return cfg;
}
