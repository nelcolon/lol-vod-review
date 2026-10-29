/**
 * Classify a `KillerName` / `VictimName` / assister string.
 *
 * Champion names are bare Riot ID game names (no `#tag`). Non-champion killers use
 * internal names: minions `Minion_T100L1S07`, turrets `Turret_...`, monsters `SRU_...`.
 * Only champions can be identified reliably, and only with the player list.
 */
export type ActorKind = 'champion' | 'minion' | 'turret' | 'monster' | 'unknown';

/** Strip a `#tag` suffix so `Name#EUW` and `Name` compare equal. */
export const bareGameName = (name: string): string => {
  const i = name.lastIndexOf('#');
  return i > 0 ? name.slice(0, i) : name;
};

export function classifyActor(name: string, playerNames: Iterable<string> = []): ActorKind {
  if (typeof name !== 'string' || name.length === 0) return 'unknown';
  const bare = bareGameName(name);
  for (const p of playerNames) {
    if (p === name || bareGameName(p) === bare) return 'champion';
  }
  if (/^Minion_/i.test(name)) return 'minion';
  if (/^Turret_/i.test(name)) return 'turret';
  if (/^SRU_/i.test(name)) return 'monster';
  return 'unknown';
}
