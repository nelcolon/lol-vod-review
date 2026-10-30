import { readFileSync } from 'node:fs';
import type { PlayItem, PlayItemChange, PlayKill, PlayPlayer, PlayRole, PlayState } from '../../shared/contracts';
import type { DdragonData } from './ddragon';

/**
 * Game state around a moment, from `players.jsonl` (written next to the video while recording)
 * and the League client's post-game timeline.
 *
 * `players.jsonl` holds two kinds of lines, both keyed by game time `t` (seconds):
 *  - `{ t, players: SavedPlayer[] }` whenever anyone's items, level or score changed;
 *  - `{ t, gold }`: your unspent gold, whenever it changed.
 */
export interface SavedPlayer {
  name: string;
  champion: string;
  championKey: string;
  team: 'ORDER' | 'CHAOS';
  /** TOP / JUNGLE / MIDDLE / BOTTOM / UTILITY; '' or absent in old logs. */
  position?: string;
  level: number;
  isDead: boolean;
  kills: number;
  deaths: number;
  assists: number;
  items: Array<{ id: number; count: number; slot: number }>;
  spells: Array<{ name: string; key: string }>;
}

export interface PlayersLog {
  snaps: Array<{ t: number; players: SavedPlayer[] }>;
  gold: Array<{ t: number; gold: number }>;
}

export function parsePlayersLog(text: string): PlayersLog {
  const log: PlayersLog = { snaps: [], gold: [] };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as { t?: unknown; players?: unknown; gold?: unknown };
      if (typeof o.t !== 'number') continue;
      if (Array.isArray(o.players)) log.snaps.push({ t: o.t, players: o.players as SavedPlayer[] });
      else if (typeof o.gold === 'number') log.gold.push({ t: o.t, gold: o.gold });
    } catch {
      /* a torn last line after a crash */
    }
  }
  log.snaps.sort((a, b) => a.t - b.t);
  log.gold.sort((a, b) => a.t - b.t);
  return log;
}

export function readPlayersLog(path: string): PlayersLog {
  try {
    return parsePlayersLog(readFileSync(path, 'utf8'));
  } catch {
    return { snaps: [], gold: [] };
  }
}

/** Last entry at or before `t` (the first one if all are later). */
function at<T extends { t: number }>(list: readonly T[], t: number): T | undefined {
  let found: T | undefined;
  for (const x of list) {
    if (x.t <= t) found = x;
    else break;
  }
  return found ?? list[0];
}

/** Post-game timeline from the League client (`/lol-match-history/v1/game-timelines/{id}` + `/games/{id}`). */
export interface LcuTimeline {
  timeline: { frames: Array<{ timestamp: number; participantFrames: Record<string, { totalGold?: number }> }> };
  game: {
    gameVersion?: string;
    participants: Array<{ participantId: number; championId: number; teamId: number; stats?: { win?: boolean } }>;
    participantIdentities: Array<{ participantId: number; player: { gameName?: string } }>;
    teams?: Array<{ teamId: number; win?: string }>;
  };
}

/**
 * Win/Lose from the League client's match history, for games whose GameEnd event never
 * arrived (ARAM: Mayhem ends without one). Matched by my name, else by my team.
 */
export function resultFromLcu(game: LcuTimeline['game'], me: { name: string; team: string }): 'Win' | 'Lose' | null {
  const base = (n: string) => n.split('#')[0]!.trim().toLowerCase();
  const id = game.participantIdentities.find((i) => i.player.gameName && base(i.player.gameName) === base(me.name));
  const p = id && game.participants.find((x) => x.participantId === id.participantId);
  if (typeof p?.stats?.win === 'boolean') return p.stats.win ? 'Win' : 'Lose';
  const teamId = p?.teamId ?? (me.team === 'CHAOS' ? 200 : 100);
  const t = game.teams?.find((x) => x.teamId === teamId);
  if (t?.win === 'Win') return 'Win';
  if (t?.win === 'Fail') return 'Lose';
  return null;
}

/** Total gold per player name (and per champion id, as a fallback) at the last full minute before `t`. */
function minuteGold(lcu: LcuTimeline | null, t: number, dd: DdragonData | null): { minute: number; byName: Map<string, number>; byChamp: Map<string, number> } | null {
  const frames = lcu?.timeline.frames ?? [];
  if (!lcu || frames.length === 0) return null;
  const idx = Math.max(0, Math.min(frames.length - 1, Math.floor(t / 60)));
  const frame = frames[idx]!;
  const byName = new Map<string, number>();
  const byChamp = new Map<string, number>();
  for (const p of lcu.game.participants) {
    const gold = frame.participantFrames[String(p.participantId)]?.totalGold;
    if (typeof gold !== 'number') continue;
    const name = lcu.game.participantIdentities.find((i) => i.participantId === p.participantId)?.player.gameName;
    if (name) byName.set(name, gold);
    const champ = dd?.champions[String(p.championId)];
    if (champ) byChamp.set(champ, gold);
  }
  return { minute: Math.round(frame.timestamp / 60_000), byName, byChamp };
}

/** Item actives that show up in the inventory: the item turns into another one when used. */
const USED_INTO: Record<number, number> = { 2420: 2421, 2419: 2421 }; // Stopwatch → Broken Stopwatch

/**
 * Inventory diff over the play. Consumables that went down were used; an item that turned into
 * its used form (Stopwatch) was used; other items that disappeared while a new item appeared
 * were built into it, so only the purchase is reported. Anything else that vanished was sold.
 */
export function diffItems(
  before: SavedPlayer['items'],
  after: SavedPlayer['items'],
  isConsumable: (id: number) => boolean,
): { used: Array<[number, number]>; bought: Array<[number, number]>; sold: Array<[number, number]> } {
  const cb = countById(before);
  const ca = countById(after);
  const lost: Array<[number, number]> = [];
  const gained: Array<[number, number]> = [];
  for (const [id, n] of cb) if ((ca.get(id) ?? 0) < n) lost.push([id, n - (ca.get(id) ?? 0)]);
  for (const [id, n] of ca) if ((cb.get(id) ?? 0) < n) gained.push([id, n - (cb.get(id) ?? 0)]);
  const used: Array<[number, number]> = [];
  const sold: Array<[number, number]> = [];
  const usedForms = new Set<number>();
  for (const [id, n] of lost) {
    const into = USED_INTO[id];
    if (into !== undefined && gained.some(([g]) => g === into)) {
      used.push([id, n]);
      usedForms.add(into);
    } else if (isConsumable(id)) used.push([id, n]);
    else sold.push([id, n]);
  }
  const bought = gained.filter(([id]) => !usedForms.has(id));
  // components disappear into the item bought with them
  const builtSomething = bought.some(([id]) => !isConsumable(id));
  return { used, bought, sold: builtSomething ? [] : sold };
}

function countById(items: SavedPlayer['items']): Map<number, number> {
  const m = new Map<number, number>();
  for (const i of items) m.set(i.id, (m.get(i.id) ?? 0) + Math.max(1, i.count));
  return m;
}

export interface PlayStateInput {
  momentId: string;
  triggerS: number;
  beforeS: number;
  afterS: number;
  /** Names involved in the moment's events and how. */
  involved: Map<string, PlayRole[]>;
  /** Kills in the play (killer → victim), for "killed X / killed by Y". */
  kills?: Kill[];
  me: { name: string; team: string } | null;
  log: PlayersLog;
  /** Used when the log is empty (games recorded before items were saved). */
  participants: Array<{ name: string; champion: string; team: 'ORDER' | 'CHAOS'; role?: string | null }>;
  lcu: LcuTimeline | null;
  dd: DdragonData | null;
}

export function computePlayState(input: PlayStateInput): PlayState {
  const { log, dd } = input;
  const item = (id: number, count: number): PlayItem => ({ id, name: dd?.items[id]?.name ?? `Item ${id}`, count, gold: dd?.items[id]?.gold ?? 0 });
  const change = (id: number, count: number): PlayItemChange => ({ id, name: dd?.items[id]?.name ?? `Item ${id}`, count, t: null });
  const gold = minuteGold(input.lcu, input.triggerS, dd);

  const atTrigger = at(log.snaps, input.triggerS + 0.5);

  // Viego: while possessing, the game reports the possessed champion's items as his. Snapshots
  // where a player's build equals another player's are skipped for the item diff and display.
  const buildKey = (p: SavedPlayer) =>
    p.items
      .filter((i) => i.slot !== 6)
      .map((i) => i.id)
      .sort((x, y) => x - y)
      .join(',');
  const mirrors = (p: SavedPlayer, snap: { players: SavedPlayer[] }) => {
    const k = buildKey(p);
    return k !== '' && snap.players.some((o) => o.name !== p.name && buildKey(o) === k);
  };
  /** The player's own entry in the last snapshot at or before `t` that is not a possession mirror. */
  const ownAt = (name: string, t: number): SavedPlayer | undefined => {
    let found: SavedPlayer | undefined;
    for (const snap of log.snaps) {
      if (snap.t > t && found) break;
      const p = snap.players.find((x) => x.name === name);
      if (p && !mirrors(p, snap)) found = p;
      if (snap.t > t) break;
    }
    return found;
  };
  /** First time inside the window that the player held more of `id` than at the start. */
  const boughtAt = (name: string, id: number, startCount: number): number | null => {
    for (const snap of log.snaps) {
      if (snap.t <= input.beforeS) continue;
      if (snap.t > input.afterS) break;
      const p = snap.players.find((x) => x.name === name);
      if (!p || mirrors(p, snap)) continue;
      if ((countById(p.items).get(id) ?? 0) > startCount) return snap.t;
    }
    return null;
  };

  const base: SavedPlayer[] =
    atTrigger?.players.map((p) => (mirrors(p, atTrigger) ? { ...p, items: ownAt(p.name, input.triggerS)?.items ?? p.items } : p)) ??
    input.participants.map((p) => ({ name: p.name, champion: p.champion, championKey: '', team: p.team, level: 0, isDead: false, kills: 0, deaths: 0, assists: 0, items: [], spells: [] }));

  const champOf = (name: string) => base.find((x) => x.name === name)?.champion ?? input.participants.find((x) => x.name === name)?.champion ?? nonChampion(name);
  const keyOf = (name: string) => base.find((x) => x.name === name)?.championKey ?? '';
  const kill = (name: string, t: number): PlayKill => ({ champion: champOf(name), championKey: keyOf(name), t });
  const kills = input.kills ?? [];
  const positionOf = (p: SavedPlayer) => p.position || input.participants.find((x) => x.name === p.name)?.role || '';
  const itemGoldOf = (p: SavedPlayer) =>
    p.items.reduce((sum, i) => {
      const d = dd?.items[i.id];
      return d && !d.consumable && !d.trinket ? sum + d.gold * Math.max(1, i.count) : sum;
    }, 0);

  const players: PlayPlayer[] = base.map((p) => {
    const killed: PlayKill[] = kills.filter((k) => k.killer === p.name).map((k) => kill(k.victim, k.t));
    const killedBy: PlayKill[] = kills.filter((k) => k.victim === p.name).map((k) => kill(k.killer, k.t));
    const pos = positionOf(p);
    const opp = pos ? base.find((x) => x.team !== p.team && positionOf(x) === pos) : undefined;
    const b = ownAt(p.name, input.beforeS);
    const a = ownAt(p.name, input.afterS);
    const diff = b && a ? diffItems(b.items, a.items, (id) => dd?.items[id]?.consumable ?? false) : { used: [], bought: [], sold: [] };
    const startCounts = b ? countById(b.items) : new Map<number, number>();
    const toChanges = (list: Array<[number, number]>, timed = false) =>
      list.map(([id, n]) => ({ ...change(id, n), t: timed ? boughtAt(p.name, id, startCounts.get(id) ?? 0) : null }));
    const items = [...p.items].sort((x, y) => x.slot - y.slot).map((i) => item(i.id, i.count));
    const itemGold = itemGoldOf(p);
    return {
      name: p.name,
      champion: p.champion,
      championKey: p.championKey,
      team: p.team,
      isMe: p.name === input.me?.name,
      roles: input.involved.get(p.name) ?? [],
      level: p.level,
      levelBefore: b?.level ?? p.level,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      items,
      itemGold,
      spells: p.spells,
      killed,
      killedBy,
      vs: opp ? { champion: opp.champion, championKey: opp.championKey, diff: itemGold - itemGoldOf(opp) } : null,
      used: toChanges(diff.used),
      bought: toChanges(diff.bought, true),
      sold: toChanges(diff.sold),
      totalGold: gold?.byName.get(p.name) ?? gold?.byChamp.get(p.championKey) ?? null,
    };
  });

  // my team first; within a team, the people in the play first
  const myTeam = input.me?.team ?? 'ORDER';
  players.sort((x, y) => Number(y.team === myTeam) - Number(x.team === myTeam) || Number(y.isMe || y.roles.length > 0) - Number(x.isMe || x.roles.length > 0));

  return {
    momentId: input.momentId,
    triggerS: input.triggerS,
    beforeS: input.beforeS,
    afterS: input.afterS,
    ddragonVersion: dd?.version ?? null,
    hasItems: log.snaps.length > 0,
    myGold: at(log.gold, input.triggerS)?.gold ?? null,
    goldMinute: gold?.minute ?? null,
    players,
  };
}

export interface Kill {
  killer: string;
  victim: string;
  t: number;
}

/** Turret_T2_C_05_A → Turret, SRU_ChaosMinionMelee → Minion; anything else as is. */
function nonChampion(name: string): string {
  if (/turret/i.test(name)) return 'Turret';
  if (/minion/i.test(name)) return 'Minions';
  if (/^SRU_/i.test(name)) return 'Monster';
  return name || 'Unknown';
}

export function killsIn(events: Array<{ name: string; payload: Record<string, unknown>; gameTimeS: number }>): Kill[] {
  return events
    .filter((e) => e.name === 'ChampionKill')
    .map((e) => ({ killer: String(e.payload['KillerName'] ?? ''), victim: String(e.payload['VictimName'] ?? ''), t: e.gameTimeS }))
    .sort((a, b) => a.t - b.t);
}

/** Killer / victim / assisters of the moment's ChampionKill events. */
export function involvedIn(events: Array<{ name: string; payload: Record<string, unknown> }>): Map<string, PlayRole[]> {
  const out = new Map<string, PlayRole[]>();
  const add = (name: unknown, role: PlayRole) => {
    if (typeof name !== 'string' || !name) return;
    const roles = out.get(name) ?? [];
    if (!roles.includes(role)) roles.push(role);
    out.set(name, roles);
  };
  for (const e of events) {
    if (e.name !== 'ChampionKill') continue;
    add(e.payload['KillerName'], 'killer');
    add(e.payload['VictimName'], 'victim');
    for (const a of Array.isArray(e.payload['Assisters']) ? e.payload['Assisters'] : []) add(a, 'assist');
  }
  return out;
}
