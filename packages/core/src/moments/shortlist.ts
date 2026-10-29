import type { Moment, MomentTheme } from './engine.js';

export interface ShortlistOptions {
  /** Total moments to keep. Default 8. */
  max?: number;
  /** Cap per theme, e.g. `{ kills: 2 }`. Unlisted themes are uncapped. */
  perTheme?: Partial<Record<MomentTheme, number>>;
  /** Drop moments below this score. Default 0. */
  minScore?: number;
  /** Only these themes (the user's focus filter). */
  themes?: MomentTheme[];
}

export const DEFAULT_PER_THEME: Partial<Record<MomentTheme, number>> = {
  deaths: 5,
  objectives: 3,
  kills: 2,
  team: 2,
};

/**
 * Top-N moments by score with per-theme caps, so a 0/10 game does not produce ten death
 * cards and nothing else. Output is sorted by score (desc), ties by time.
 */
export function shortlist(moments: readonly Moment[], options: ShortlistOptions = {}): Moment[] {
  const max = options.max ?? 8;
  const caps = { ...DEFAULT_PER_THEME, ...(options.perTheme ?? {}) };
  const minScore = options.minScore ?? 0;
  const themes = options.themes ? new Set(options.themes) : null;

  const sorted = [...moments].sort((a, b) => b.score - a.score || a.tTriggerS - b.tTriggerS);
  const counts: Partial<Record<MomentTheme, number>> = {};
  const out: Moment[] = [];
  for (const m of sorted) {
    if (out.length >= max) break;
    if (m.score < minScore) continue;
    if (themes && !themes.has(m.theme)) continue;
    const cap = caps[m.theme];
    const n = counts[m.theme] ?? 0;
    if (cap !== undefined && n >= cap) continue;
    counts[m.theme] = n + 1;
    out.push(m);
  }
  return out;
}

export function groupByTheme(moments: readonly Moment[]): Record<MomentTheme, Moment[]> {
  const groups: Record<MomentTheme, Moment[]> = { deaths: [], objectives: [], kills: [], team: [] };
  for (const m of moments) groups[m.theme].push(m);
  return groups;
}
