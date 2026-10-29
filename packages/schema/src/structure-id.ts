/**
 * Structure IDs (TurretKilled / InhibKilled / InhibRespawn* payloads) have gone through
 * three generations:
 *
 *   legacy (<=2024)  Turret_T2_L_03_A        Barracks_T2_R1
 *   2026-01          Turret_T100_L2_P3_1509986696   Inhib_T200_L1_P1_1931666598
 *   2026-05          Turret_TChaos_L2_P3_<hash>     (Inhib_TOrder_... presumed)
 *
 * The team is derived from the ID (T1/T100/TOrder = ORDER/blue, T2/T200/TChaos =
 * CHAOS/red). Legacy lane letters L/C/R are taken as top/mid/bot (Riot's old naming).
 * The mapping of the new L0/L1/L2 tokens to top/mid/bot is UNCONFIRMED: `laneGuess`
 * carries a best guess and `laneGuessConfirmed` is always false for them.
 */
import type { Team } from './events.js';

export type StructureKind = 'turret' | 'inhibitor' | 'nexus' | 'unknown';
export type LaneName = 'top' | 'mid' | 'bot';
export type LaneToken = 'L0' | 'L1' | 'L2';
export type StructureIdGeneration = 'legacy' | '2026-01' | '2026-05' | 'unknown';

export interface ParsedStructureId {
  kind: StructureKind;
  team: Team | undefined;
  /** `L0|L1|L2` for the new formats (raw token), `top|mid|bot` for legacy IDs. */
  lane: LaneToken | LaneName | undefined;
  /** The lane token exactly as it appears in the ID (`L`, `C`, `R`, `L0`, ...). */
  laneToken: string | undefined;
  /** Best-guess lane name; only legacy IDs are considered confirmed. */
  laneGuess: LaneName | undefined;
  laneGuessConfirmed: boolean;
  /** `03` / `03_A` style for legacy turrets, `P3` for new ones, `1` for legacy barracks. */
  position: string | undefined;
  /** Numeric per-structure suffix of the 2026 formats (stable across games). */
  hash: string | undefined;
  /** The team token exactly as it appears (`T2`, `T200`, `TChaos`). */
  teamToken: string | undefined;
  generation: StructureIdGeneration;
  raw: string;
}

/**
 * Best guess for the 2026 lane tokens. Evidence (inference only): in a Jan 2026 capture
 * the first `Turret_T100_L2_P3` fell to a player named "EveryBotLoses", and a solo
 * Practice Tool push went L1 P3 -> P2 -> P1 -> Inhib L1 (mid). Unconfirmed.
 */
export const LANE_TOKEN_GUESS: Readonly<Record<LaneToken, LaneName>> = {
  L0: 'top',
  L1: 'mid',
  L2: 'bot',
};

const LEGACY_LANE: Readonly<Record<string, LaneName>> = { L: 'top', C: 'mid', R: 'bot' };

const TEAM_TOKENS: Readonly<Record<string, { team: Team; gen: StructureIdGeneration }>> = {
  T1: { team: 'ORDER', gen: 'legacy' },
  T2: { team: 'CHAOS', gen: 'legacy' },
  T100: { team: 'ORDER', gen: '2026-01' },
  T200: { team: 'CHAOS', gen: '2026-01' },
  TORDER: { team: 'ORDER', gen: '2026-05' },
  TCHAOS: { team: 'CHAOS', gen: '2026-05' },
};

const KIND_PREFIX: Readonly<Record<string, StructureKind>> = {
  TURRET: 'turret',
  BARRACKS: 'inhibitor',
  INHIB: 'inhibitor',
  INHIBITOR: 'inhibitor',
  HQ: 'nexus',
  NEXUS: 'nexus',
};

function unknownResult(raw: string): ParsedStructureId {
  return {
    kind: 'unknown',
    team: undefined,
    lane: undefined,
    laneToken: undefined,
    laneGuess: undefined,
    laneGuessConfirmed: false,
    position: undefined,
    hash: undefined,
    teamToken: undefined,
    generation: 'unknown',
    raw,
  };
}

/**
 * Parse a structure ID. Never throws; anything unrecognised comes back with
 * `kind: 'unknown'` (or a known kind with missing fields) and the original `raw`.
 */
export function parseStructureId(id: string): ParsedStructureId {
  const out = unknownResult(id);
  if (typeof id !== 'string' || id.length === 0) return out;
  const parts = id.split('_');
  const kind = KIND_PREFIX[(parts[0] ?? '').toUpperCase()];
  if (!kind) return out;
  out.kind = kind;

  let i = 1;
  const teamTok = parts[i];
  const team = teamTok ? TEAM_TOKENS[teamTok.toUpperCase()] : undefined;
  if (team && teamTok) {
    out.team = team.team;
    out.teamToken = teamTok;
    out.generation = team.gen;
    i++;
  }

  const rest = parts.slice(i);
  if (out.generation === 'legacy') {
    // Turret_T2_L_03_A | Barracks_T2_R1 | Barracks_T1_C1
    const joined = rest.join('_');
    const m = /^([LCR])_?(\d+)(?:_([A-Z]))?$/.exec(joined);
    if (m) {
      const letter = m[1] as string;
      out.laneToken = letter;
      out.lane = LEGACY_LANE[letter];
      out.laneGuess = LEGACY_LANE[letter];
      out.laneGuessConfirmed = true;
      out.position = m[3] ? `${m[2]}_${m[3]}` : m[2];
    } else if (rest.length > 0) {
      out.position = joined;
    }
    return out;
  }

  // 2026 formats: <Kind>_<Team>_L<n>_P<n>_<hash>; tolerate missing pieces.
  for (const tok of rest) {
    if (/^L\d+$/.test(tok) && out.laneToken === undefined) {
      out.laneToken = tok;
      if (tok === 'L0' || tok === 'L1' || tok === 'L2') {
        out.lane = tok;
        out.laneGuess = LANE_TOKEN_GUESS[tok];
      }
    } else if (/^P\d+$/.test(tok) && out.position === undefined) {
      out.position = tok;
    } else if (/^\d+$/.test(tok) && out.hash === undefined) {
      out.hash = tok;
    }
  }
  return out;
}

/** True when the ID was understood well enough to know its kind and team. */
export const isRecognisedStructureId = (p: ParsedStructureId): boolean =>
  p.kind !== 'unknown' && p.team !== undefined;
