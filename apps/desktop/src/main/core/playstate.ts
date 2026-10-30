import { readFileSync } from 'node:fs';
import type { PlayItem, PlayItemChange, PlayPlayer, PlayRole, PlayState } from '../../shared/contracts';
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
    participants: Array<{ participantId: number; championId: number; teamId: number }>;
    participantIdentities: Array<{ participantId: number; player: { gameName?: string } }>;
  };
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
  me: { name: string; team: string } | null;
  log: PlayersLog;
  /** Used when the log is empty (games recorded before items were saved). */
  participants: Array<{ name: string; champion: string; team: 'ORDER' | 'CHAOS' }>;
  lcu: LcuTimeline | null;
  dd: DdragonData | null;
}

export function computePlayState(input: PlayStateInput): PlayState {
  const { log, dd } = input;
  const item = (id: number, count: number): PlayItem => ({ id, name: dd?.items[id]?.name ?? `Item ${id}`, count, gold: dd?.items[id]?.gold ?? 0 });
  const change = (id: number, count: number): PlayItemChange => ({ id, name: dd?.items[id]?.name ?? `Item ${id}`, count });
  const gold = minuteGold(input.lcu, input.triggerS, dd);

  const before = at(log.snaps, input.beforeS);
  const atTrigger = at(log.snaps, input.triggerS + 0.5);
  const after = at(log.snaps, input.afterS);

  const base: SavedPlayer[] =
    atTrigger?.players ??
    input.participants.map((p) => ({ name: p.name, champion: p.champion, championKey: '', team: p.team, level: 0, isDead: false, kills: 0, deaths: 0, assists: 0, items: [], spells: [] }));

  const players: PlayPlayer[] = base.map((p) => {
    const b = before?.players.find((x) => x.name === p.name);
    const a = after?.players.find((x) => x.name === p.name);
    const diff = b && a ? diffItems(b.items, a.items, (id) => dd?.items[id]?.consumable ?? false) : { used: [], bought: [], sold: [] };
    const toChanges = (list: Array<[number, number]>) => list.map(([id, n]) => change(id, n));
    const items = [...p.items].sort((x, y) => x.slot - y.slot).map((i) => item(i.id, i.count));
    const itemGold = p.items.reduce((sum, i) => {
      const d = dd?.items[i.id];
      return d && !d.consumable && !d.trinket ? sum + d.gold * Math.max(1, i.count) : sum;
    }, 0);
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
      used: toChanges(diff.used),
      bought: toChanges(diff.bought),
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
