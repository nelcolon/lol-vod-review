/**
 * Moments engine v1 (PLAN §3.6): rule-based ranking over the live event log.
 *
 * Pipeline: tag each event (involvement, stakes, side) → cluster events within 15 s →
 * one moment per cluster with a window [trigger − preRoll, last + postRoll] → score →
 * labels, title, reasons.
 */

import type { EventRow } from '../events/normalize.js';
import { otherTeam, structureTeam } from '../events/normalize.js';
import { formatGameTime, type Team } from '../types.js';
import { resolveMomentsConfig, type MomentsConfig } from './config.js';

export type MomentKind = 'own_death' | 'own_kill' | 'own_assist' | 'objective' | 'structure' | 'ace' | 'multikill' | 'team_fight';
export type MomentTheme = 'deaths' | 'objectives' | 'kills' | 'team';
export type MomentLabel =
  | 'solo'
  | 'gank'
  | 'teamfight'
  | 'sacrifice'
  | 'meaningless'
  | 'traded_into_objective'
  | 'executed'
  | 'early'
  | 'stolen'
  | 'first_blood'
  | 'first_tower'
  | 'soul_point'
  | 'multikill'
  | 'ace';

export interface ScoreComponents {
  selfInvolvement: number;
  stakes: number;
  participants: number;
  phase: number;
  deathCost: number;
}

export interface Moment {
  /** Stable within a game: `${kind}:${triggerEventId}`. */
  id: string;
  kind: MomentKind;
  theme: MomentTheme;
  /** e.g. "Solo death, 11:42" */
  title: string;
  /** 0..1 */
  score: number;
  components: ScoreComponents;
  labels: MomentLabel[];
  /** Human-readable reasons why it ranked where it did. */
  reasons: string[];
  /** Window in game seconds. */
  tStartS: number;
  tTriggerS: number;
  tEndS: number;
  /** Window on video (null when the trigger event has no video placement). */
  segmentId: number | null;
  tStartMs: number | null;
  tTriggerMs: number | null;
  tEndMs: number | null;
  triggerEventId: number;
  eventIds: number[];
}

export interface Participant {
  name: string;
  team: Team;
  champion?: string;
}

export interface PlayerSnapshot {
  gameTime: number;
  players: Array<{ name: string; isDead: boolean; respawnTimer: number; level: number }>;
}

export interface MomentsInput {
  /** Normalized events (FirstBlood/FirstBrick already folded). */
  events: readonly EventRow[];
  me: { name: string; team: Team };
  participants?: readonly Participant[];
  /** `/playerlist` snapshots, used to read `respawnTimer` at own deaths. */
  playerSnapshots?: readonly PlayerSnapshot[];
  config?: Partial<MomentsConfig>;
}

// --- tagging ---------------------------------------------------------------------------

type Side = 'ally' | 'enemy' | 'unknown';

interface Tagged {
  row: EventRow;
  t: number;
  /** Is this a trigger on its own (vs. context that only joins a cluster)? */
  trigger: boolean;
  involvement: number;
  involvementKind: 'death' | 'kill' | 'assist' | 'none';
  stakes: number;
  /** Which side benefited (killing team relative to me). */
  side: Side;
  objective: string | null; // "Baron", "Soul drake", "first tower"...
  stolen: boolean;
  names: string[]; // champions involved
  isKill: boolean;
  isObjective: boolean;
  killerIsChampion: boolean;
  assisterCount: number;
}

export function computeMoments(input: MomentsInput): Moment[] {
  const cfg = resolveMomentsConfig(input.config);
  const me = input.me;
  const teamOf = buildTeamLookup(input.participants ?? [], me);

  const rows = [...input.events].sort((a, b) => a.game_time_s - b.game_time_s || a.event_id - b.event_id);
  const tagged = tagEvents(rows, me, teamOf, cfg);
  const clusters = clusterEvents(tagged, cfg.clusterGapS);

  const moments: Moment[] = [];
  for (const cluster of clusters) {
    if (!cluster.some((e) => e.trigger)) continue;
    moments.push(buildMoment(cluster, tagged, me, teamOf, cfg, input.playerSnapshots ?? []));
  }
  moments.sort((a, b) => b.score - a.score || a.tTriggerS - b.tTriggerS);
  return moments;
}

function buildTeamLookup(participants: readonly Participant[], me: { name: string; team: Team }): (name: string | undefined | null) => Team | undefined {
  const map = new Map<string, Team>();
  for (const p of participants) map.set(p.name, p.team);
  map.set(me.name, me.team);
  return (name) => (name ? map.get(name) : undefined);
}

function tagEvents(rows: EventRow[], me: { name: string; team: Team }, teamOf: (n: string | undefined | null) => Team | undefined, cfg: MomentsConfig): Tagged[] {
  const drakes: Record<Team, number> = { ORDER: 0, CHAOS: 0 };
  let firstTowerSeen = false;
  const out: Tagged[] = [];

  for (const row of rows) {
    const p = row.payload;
    const base: Tagged = {
      row,
      t: row.game_time_s,
      trigger: false,
      involvement: 0,
      involvementKind: 'none',
      stakes: 0,
      side: 'unknown',
      objective: null,
      stolen: false,
      names: [],
      isKill: false,
      isObjective: false,
      killerIsChampion: false,
      assisterCount: 0,
    };
    const killer = str(p['KillerName']);
    const assisters = arr(p['Assisters']);
    const killerTeam = teamOf(killer);

    switch (row.name) {
      case 'ChampionKill': {
        const victim = str(p['VictimName']);
        base.isKill = true;
        base.names = uniq([killer, victim, ...assisters].filter(isStr));
        base.killerIsChampion = killerTeam !== undefined;
        base.assisterCount = assisters.length;
        base.stakes = cfg.stakes.kill;
        if (victim === me.name) {
          base.involvement = cfg.involvement.death;
          base.involvementKind = 'death';
          base.trigger = true;
          base.side = 'enemy';
        } else if (killer === me.name) {
          base.involvement = cfg.involvement.kill;
          base.involvementKind = 'kill';
          base.trigger = true;
          base.side = 'ally';
        } else if (assisters.includes(me.name)) {
          base.involvement = cfg.involvement.assist;
          base.involvementKind = 'assist';
          base.trigger = true;
          base.side = 'ally';
        } else {
          const vt = teamOf(victim);
          base.side = vt === me.team ? 'enemy' : vt === undefined ? (killerTeam === me.team ? 'ally' : 'unknown') : 'ally';
        }
        break;
      }
      case 'Multikill': {
        base.trigger = true;
        const streak = num(p['KillStreak']) ?? 2;
        base.stakes = Math.min(1, cfg.stakes.multikillBase + cfg.stakes.multikillPerExtra * Math.max(0, streak - 2));
        base.names = killer ? [killer] : [];
        base.side = killerTeam === me.team ? 'ally' : killerTeam === undefined ? 'unknown' : 'enemy';
        if (killer === me.name) {
          base.involvement = cfg.involvement.kill;
          base.involvementKind = 'kill';
        } else {
          base.involvement = cfg.involvement.teamEvent;
        }
        base.objective = `${multikillName(streak)}`;
        break;
      }
      case 'Ace': {
        base.trigger = true;
        base.stakes = cfg.stakes.ace;
        const acingTeam = str(p['AcingTeam']) as Team | undefined;
        base.side = acingTeam === me.team ? 'ally' : acingTeam ? 'enemy' : 'unknown';
        base.involvement = cfg.involvement.teamEvent;
        base.objective = 'Ace';
        break;
      }
      case 'TurretKilled':
      case 'InhibKilled': {
        base.trigger = true;
        base.isObjective = true;
        const id = str(p[row.name]);
        const owner = structureTeam(id);
        const takingTeam = owner ? otherTeam(owner) : killerTeam;
        base.side = takingTeam === me.team ? 'ally' : takingTeam === undefined ? 'unknown' : 'enemy';
        base.names = uniq([killer, ...assisters].filter(isStr).filter((n) => teamOf(n) !== undefined));
        if (row.name === 'InhibKilled') {
          base.stakes = cfg.stakes.inhibitor;
          base.objective = 'inhibitor';
        } else {
          const first = !firstTowerSeen || p['firstBrick'] === true;
          firstTowerSeen = true;
          base.stakes = first ? cfg.stakes.firstTower : cfg.stakes.tower;
          base.objective = first ? 'first tower' : 'tower';
        }
        applyObjectiveInvolvement(base, killer, assisters, me, cfg);
        break;
      }
      case 'DragonKill':
      case 'BaronKill':
      case 'HeraldKill':
      case 'HordeKill':
      case 'AtakhanKill': {
        base.trigger = true;
        base.isObjective = true;
        base.stolen = p['Stolen'] === true || p['Stolen'] === 'True';
        base.side = killerTeam === me.team ? 'ally' : killerTeam === undefined ? 'unknown' : 'enemy';
        base.names = uniq([killer, ...assisters].filter(isStr).filter((n) => teamOf(n) !== undefined));
        if (row.name === 'DragonKill') {
          const type = str(p['DragonType']) ?? 'Dragon';
          if (type === 'Elder') {
            base.stakes = cfg.stakes.elder;
            base.objective = 'Elder dragon';
          } else {
            const soulPoint = drakes.ORDER >= 3 || drakes.CHAOS >= 3;
            if (killerTeam) drakes[killerTeam] += 1;
            const completesSoul = killerTeam !== undefined && drakes[killerTeam] === 4;
            base.stakes = soulPoint || completesSoul ? cfg.stakes.soulDrake : cfg.stakes.drake;
            base.objective = completesSoul ? `${type} Soul` : soulPoint ? `${type} drake (soul point)` : `${type} drake`;
          }
        } else if (row.name === 'BaronKill') {
          base.stakes = cfg.stakes.baron;
          base.objective = 'Baron';
        } else if (row.name === 'HeraldKill') {
          base.stakes = cfg.stakes.herald;
          base.objective = 'Herald';
        } else if (row.name === 'HordeKill') {
          base.stakes = cfg.stakes.grubs;
          base.objective = 'Voidgrubs';
        } else {
          base.stakes = cfg.stakes.atakhan;
          base.objective = 'Atakhan';
        }
        if (base.stolen) base.stakes = Math.min(1, base.stakes + cfg.stakes.stolenBonus);
        applyObjectiveInvolvement(base, killer, assisters, me, cfg);
        break;
      }
      default:
        // GameStart, MinionsSpawning, InhibRespawn*, GameEnd, orphans, unknown: context only.
        continue;
    }
    out.push(base);
  }
  return out;
}

function applyObjectiveInvolvement(base: Tagged, killer: string | undefined, assisters: string[], me: { name: string }, cfg: MomentsConfig): void {
  if (killer === me.name) {
    base.involvement = cfg.involvement.kill;
    base.involvementKind = 'kill';
  } else if (assisters.includes(me.name)) {
    base.involvement = cfg.involvement.assist;
    base.involvementKind = 'assist';
  } else {
    base.involvement = cfg.involvement.teamEvent;
  }
}

// --- clustering ------------------------------------------------------------------------

function clusterEvents(tagged: Tagged[], gapS: number): Tagged[][] {
  const clusters: Tagged[][] = [];
  let current: Tagged[] = [];
  for (const e of tagged) {
    const last = current[current.length - 1];
    if (last && e.t - last.t > gapS) {
      clusters.push(current);
      current = [];
    }
    current.push(e);
  }
  if (current.length) clusters.push(current);
  return clusters;
}

// --- moment building -------------------------------------------------------------------

function buildMoment(
  cluster: Tagged[],
  all: Tagged[],
  me: { name: string; team: Team },
  teamOf: (n: string | undefined | null) => Team | undefined,
  cfg: MomentsConfig,
  snapshots: readonly PlayerSnapshot[],
): Moment {
  const triggers = cluster.filter((e) => e.trigger);
  const primary = triggers.reduce((best, e) => (rank(e) > rank(best) ? e : best), triggers[0]!);
  const first = cluster[0]!;
  const last = cluster[cluster.length - 1]!;

  const ownDeath = cluster.find((e) => e.involvementKind === 'death');
  const kills = cluster.filter((e) => e.isKill);
  const teamfight = isTeamfight(kills, cfg);
  const labels: MomentLabel[] = [];
  const reasons: string[] = [];

  // --- components
  const selfInvolvement = Math.max(...cluster.map((e) => e.involvement));
  const stakesEvent = cluster.reduce((b, e) => (e.stakes > b.stakes ? e : b), cluster[0]!);
  const stakes = stakesEvent.stakes;
  const names = uniq(cluster.flatMap((e) => e.names));
  let participants = Math.min(1, names.length / 10);
  if (teamfight) participants = Math.max(participants, 0.6);

  let phase = 0;
  let deathCost = 0;

  switch (primary.involvementKind) {
    case 'death':
      reasons.push('You died');
      break;
    case 'kill':
      reasons.push(primary.isObjective ? `You took ${primary.objective}` : 'You got the kill');
      break;
    case 'assist':
      reasons.push(primary.isObjective ? `You helped take ${primary.objective}` : 'You assisted the kill');
      break;
    default:
      break;
  }

  if (ownDeath) {
    const t = ownDeath.t;
    if (t < cfg.lanePhaseEndS) {
      phase = cfg.laner ? 1 : 0.5;
      labels.push('early');
      reasons.push(`Died at ${formatGameTime(t)}, before ${formatGameTime(cfg.lanePhaseEndS)} (laning phase)`);
    } else if (t < 20 * 60) {
      phase = 0.5;
    } else {
      phase = 0.25;
    }

    const respawn = respawnAt(snapshots, me.name, t);
    const respawnS = respawn ?? estimateRespawnS(levelAt(snapshots, me.name, t), t);
    deathCost = Math.min(1, respawnS / 60);
    reasons.push(respawn !== undefined ? `Respawn cost ${Math.round(respawnS)} s` : `Respawn cost ≈${Math.round(respawnS)} s (estimated)`);

    // Traded into an enemy objective (±60 s)
    const traded = all.find((e) => e.isObjective && e.side === 'enemy' && Math.abs(e.t - t) <= cfg.objectiveTradeWindowS);
    if (traded) {
      deathCost = Math.min(1, deathCost + 0.5);
      labels.push('traded_into_objective');
      const delta = Math.round(traded.t - t);
      reasons.push(`Enemy took ${traded.objective} ${delta >= 0 ? `${delta} s after` : `${-delta} s before`} your death (traded into objective)`);
    }

    // Sacrifice vs meaningless: did the team convert while you were dead?
    const windowEnd = t + respawnS;
    const converted = all.find(
      (e) => e.t > t && e.t <= windowEnd && e.side === 'ally' && (e.isObjective || (e.isKill && e.involvementKind !== 'death')),
    );
    if (converted) {
      labels.push('sacrifice');
      reasons.push(`Team got ${converted.isObjective ? converted.objective : 'a kill'} ${Math.round(converted.t - t)} s later while you were dead (sacrifice)`);
    } else if (!teamfight || kills.filter((k) => k.side === 'ally').length === 0) {
      labels.push('meaningless');
      reasons.push('Nothing followed your death');
    }

    // Who killed you
    if (!ownDeath.killerIsChampion) {
      labels.push('executed');
      reasons.push(`Killed by ${str(ownDeath.row.payload['KillerName']) ?? 'a non-champion'}`);
    } else if (ownDeath.assisterCount === 0) {
      labels.push('solo');
      reasons.push('No assisters: solo death');
    } else {
      labels.push('gank');
      reasons.push(`${ownDeath.assisterCount + 1} enemies involved (gank/collapse)`);
    }
    if (ownDeath.row.payload['firstBlood'] === true) {
      labels.push('first_blood');
      reasons.push('First blood');
    }
  } else {
    const ownKill = cluster.find((e) => e.involvementKind === 'kill' && e.isKill);
    if (ownKill) {
      if (ownKill.assisterCount === 0) {
        labels.push('solo');
        reasons.push('Solo kill');
      }
      if (ownKill.row.payload['firstBlood'] === true) {
        labels.push('first_blood');
        reasons.push('First blood');
      }
    }
  }

  if (teamfight) {
    labels.push('teamfight');
    reasons.push(`${kills.length} kills within ${cfg.teamfightWindowS} s (teamfight)`);
  }
  if (stakesEvent.isObjective || stakesEvent.row.name === 'Ace') {
    const who = stakesEvent.side === 'ally' ? 'Team' : stakesEvent.side === 'enemy' ? 'Enemy' : 'Someone';
    if (stakesEvent.row.name === 'Ace') reasons.push(stakesEvent.side === 'ally' ? 'Your team aced them' : 'Your team was aced');
    else reasons.push(`${who} took ${stakesEvent.objective}`);
    if (stakesEvent.stolen) {
      labels.push('stolen');
      reasons.push(`${stakesEvent.objective} was stolen`);
    }
    if (stakesEvent.objective === 'first tower') labels.push('first_tower');
    if (stakesEvent.objective?.includes('Soul') || stakesEvent.objective?.includes('soul point')) labels.push('soul_point');
  }
  const myMulti = cluster.find((e) => e.row.name === 'Multikill' && str(e.row.payload['KillerName']) === me.name);
  if (myMulti) {
    labels.push('multikill');
    reasons.push(`${myMulti.objective}`);
  }
  if (cluster.some((e) => e.row.name === 'Ace')) labels.push('ace');
  if (names.length >= 4) reasons.push(`${names.length} champions involved`);

  const components: ScoreComponents = { selfInvolvement, stakes, participants, phase, deathCost };
  const w = cfg.weights;
  const score = round3(
    w.selfInvolvement * selfInvolvement + w.stakes * stakes + w.participants * participants + w.phase * phase + w.deathCost * deathCost,
  );

  const kind = kindOf(primary, teamfight);
  const theme = themeOf(kind, cluster);
  const tTriggerS = primary.t;
  const tStartS = Math.max(0, Math.min(tTriggerS - cfg.preRollS, first.t - 5));
  const tEndS = last.t + cfg.postRollS;
  const title = `${titleOf(kind, primary, ownDeath, labels, myMulti, stakesEvent)}, ${formatGameTime(tTriggerS)}`;

  const vt = primary.row.video_t_ms;
  const segmentId = primary.row.video_segment_id;
  const onVideo = vt !== null && segmentId !== null;

  return {
    id: `${kind}:${primary.row.event_id}`,
    kind,
    theme,
    title,
    score,
    components,
    labels: uniq(labels) as MomentLabel[],
    reasons,
    tStartS,
    tTriggerS,
    tEndS,
    segmentId: onVideo ? segmentId : null,
    tStartMs: onVideo ? Math.max(0, vt - (tTriggerS - tStartS) * 1000) : null,
    tTriggerMs: onVideo ? vt : null,
    tEndMs: onVideo ? vt + (tEndS - tTriggerS) * 1000 : null,
    triggerEventId: primary.row.event_id,
    eventIds: cluster.map((e) => e.row.event_id),
  };
}

/** Primary-event ranking: involvement first, then stakes, then earliest. */
function rank(e: Tagged): number {
  return e.involvement * 10 + e.stakes - e.t * 1e-6;
}

function isTeamfight(kills: Tagged[], cfg: MomentsConfig): boolean {
  if (kills.length < cfg.teamfightKills) return false;
  for (let i = 0; i + cfg.teamfightKills - 1 < kills.length; i++) {
    if (kills[i + cfg.teamfightKills - 1]!.t - kills[i]!.t <= cfg.teamfightWindowS) return true;
  }
  return false;
}

function kindOf(primary: Tagged, teamfight: boolean): MomentKind {
  if (primary.involvementKind === 'death') return 'own_death';
  if (primary.involvementKind === 'kill' && (primary.isKill || primary.row.name === 'Multikill')) return 'own_kill';
  if (primary.involvementKind === 'assist' && primary.isKill) return 'own_assist';
  if (primary.row.name === 'TurretKilled' || primary.row.name === 'InhibKilled') return 'structure';
  if (primary.isObjective) return 'objective';
  if (primary.row.name === 'Ace') return 'ace';
  if (primary.row.name === 'Multikill') return 'multikill';
  return teamfight ? 'team_fight' : 'team_fight';
}

/** Theme follows what the moment is about, not whatever else fell inside its 15 s cluster. */
function themeOf(kind: MomentKind, cluster: Tagged[]): MomentTheme {
  if (kind === 'own_death' || cluster.some((e) => e.involvementKind === 'death')) return 'deaths';
  if (kind === 'own_kill' || kind === 'own_assist' || kind === 'multikill') return 'kills';
  if (kind === 'objective' || kind === 'structure') return 'objectives';
  return 'team';
}

function titleOf(kind: MomentKind, primary: Tagged, ownDeath: Tagged | undefined, labels: MomentLabel[], myMulti: Tagged | undefined, stakesEvent: Tagged): string {
  const side = (e: Tagged) => (e.side === 'ally' ? 'Team' : e.side === 'enemy' ? 'Enemy' : 'Someone');
  switch (kind) {
    case 'own_death': {
      let base = 'Death';
      if (labels.includes('teamfight')) base = 'Teamfight death';
      else if (labels.includes('executed')) base = `Death to ${shortKiller(str(ownDeath?.row.payload['KillerName']))}`;
      else if (labels.includes('solo')) base = 'Solo death';
      else if (labels.includes('gank')) base = `Death in ${(ownDeath?.assisterCount ?? 0) + 1}-man collapse`;
      if (labels.includes('traded_into_objective') && stakesEvent.isObjective && stakesEvent.side === 'enemy') base += ` traded into ${stakesEvent.objective}`;
      return base;
    }
    case 'own_kill':
      if (myMulti) return capitalize(myMulti.objective ?? 'Multikill');
      if (labels.includes('teamfight')) return 'Teamfight kill';
      if (labels.includes('first_blood')) return 'First blood kill';
      return labels.includes('solo') ? 'Solo kill' : 'Kill';
    case 'own_assist':
      return labels.includes('teamfight') ? 'Teamfight assist' : 'Assist';
    case 'objective':
    case 'structure': {
      const e = stakesEvent.isObjective ? stakesEvent : primary;
      if (e.stolen) return e.side === 'ally' ? `Stole ${e.objective}` : `${capitalize(e.objective ?? 'Objective')} stolen by enemy`;
      return `${side(e)} took ${e.objective}`;
    }
    case 'ace':
      return primary.side === 'ally' ? 'Ace' : 'Enemy ace';
    case 'multikill':
      return `${side(primary)} ${primary.objective?.toLowerCase() ?? 'multikill'}`;
    default:
      return 'Fight';
  }
}

function shortKiller(name: string | undefined): string {
  if (!name) return 'the environment';
  const n = name.toLowerCase();
  if (n.includes('turret') || n.includes('tower')) return 'turret';
  if (n.includes('minion')) return 'minions';
  if (n.includes('baron')) return 'Baron';
  if (n.includes('dragon')) return 'Dragon';
  if (n.includes('herald')) return 'Herald';
  return name;
}

// --- respawn --------------------------------------------------------------------------

/** respawnTimer from the first snapshot after the death that shows the player dead. */
function respawnAt(snapshots: readonly PlayerSnapshot[], name: string, deathT: number): number | undefined {
  let best: number | undefined;
  for (const s of snapshots) {
    if (s.gameTime < deathT - 0.5 || s.gameTime > deathT + 5) continue;
    const p = s.players.find((x) => x.name === name);
    if (p?.isDead && p.respawnTimer > 0) {
      const total = p.respawnTimer + (s.gameTime - deathT);
      if (best === undefined || total > best) best = total;
    }
  }
  return best;
}

function levelAt(snapshots: readonly PlayerSnapshot[], name: string, t: number): number | undefined {
  let lvl: number | undefined;
  for (const s of snapshots) {
    if (s.gameTime > t + 5) break;
    const p = s.players.find((x) => x.name === name);
    if (p) lvl = p.level;
  }
  return lvl;
}

/** Base respawn wait by level (seconds). */
const BRW = [0, 10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5];

/**
 * Approximate death timer: base respawn by level × time-increase factor (0 before 15:00,
 * rising to ~+25% at 30:00 and ~+30% at 45:00). Used only when no `/playerlist` snapshot
 * caught the death.
 */
export function estimateRespawnS(level: number | undefined, gameTimeS: number): number {
  const lvl = level ?? Math.min(18, Math.max(1, Math.round(1 + (gameTimeS / 60) * 0.55)));
  const base = BRW[Math.min(18, Math.max(1, Math.round(lvl)))]!;
  const m = gameTimeS / 60;
  let tif = 0;
  if (m > 15 && m <= 30) tif = ((m - 15) / 15) * 0.255;
  else if (m > 30) tif = 0.255 + (Math.min(m, 45) - 30) / 15 * 0.045;
  return Math.round(base * (1 + tif) * 10) / 10;
}

// --- small utils -----------------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(isStr) : [];
}
function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
export function multikillName(streak: number): string {
  switch (streak) {
    case 2:
      return 'Double kill';
    case 3:
      return 'Triple kill';
    case 4:
      return 'Quadra kill';
    case 5:
      return 'Penta kill';
    default:
      return `${streak}-kill streak`;
  }
}
