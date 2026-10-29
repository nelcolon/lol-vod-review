/**
 * MockBackend — a fake library so the UI is fully exercisable before `@lvr/core` lands.
 *
 * Every segment points at `dev-assets/sample.mp4` (2 min, 1080p60, burned-in timecode), so
 * mock games are compressed to ~2 minutes: game clock and video clock are 1:1 with a 4 s
 * loading offset (video t = gameTime + 4 s). That makes seek accuracy verifiable against the
 * on-screen timecode. The rule-based clustering below is a scaled-down stand-in for the
 * moments engine in PLAN §3.6 (pre-roll 12 s / post-roll 4 s / cluster 6 s instead of 45/10/15).
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  CauseTag,
  Clip,
  ClipBundle,
  EventRow,
  Game,
  GameBundle,
  Lane,
  MarkerKind,
  Moment,
  MomentKind,
  Note,
  NoteInput,
  RecorderStatus,
  Settings,
  Theme,
} from '../shared/contracts';
import { CAUSE_TAGS, queueName } from '../shared/contracts';
import type { Backend } from './backend';

const LOADING_OFFSET_S = 4; // video time of gameTime 0
const PRE_ROLL_S = 12;
const POST_ROLL_S = 4;
const CLUSTER_S = 6;

interface EventSpec {
  t: number; // gameTimeS
  name: string;
  payload?: Record<string, unknown>;
}

interface GameSpec {
  id: string;
  gameId: string;
  queueId: number;
  gameMode: string;
  startedAt: string;
  result: Game['result'];
  me: string;
  myChampion: string;
  myRole: string;
  myTeam: string[]; // riot id names incl. me
  enemies: string[];
  kda: [number, number, number];
  durationS: number;
  events: EventSpec[];
}

const GAME_SPECS: GameSpec[] = [
  {
    id: 'g-2026-10-27-ahri',
    gameId: '7311882001',
    queueId: 420,
    gameMode: 'CLASSIC',
    startedAt: '2026-10-27T21:14:03.000Z',
    result: 'win',
    me: 'Lich',
    myChampion: 'Ahri',
    myRole: 'MIDDLE',
    myTeam: ['Lich', 'Toplaner Tom', 'JungleGap', 'Bot Diff', 'Hook City'],
    enemies: ['Syndra Main', 'Darius Enjoyer', 'Kayn Player', 'Jinx Dancer', 'Nautilus Hooks'],
    kda: [8, 3, 11],
    durationS: 114,
    events: [
      { t: 0, name: 'GameStart' },
      { t: 3, name: 'MinionsSpawning' },
      { t: 9, name: 'FirstBlood', payload: { Recipient: 'Kayn Player' } },
      { t: 9, name: 'ChampionKill', payload: { KillerName: 'Kayn Player', VictimName: 'Lich', Assisters: ['Syndra Main'] } },
      { t: 22, name: 'ChampionKill', payload: { KillerName: 'Lich', VictimName: 'Syndra Main', Assisters: [] } },
      { t: 31, name: 'HordeKill', payload: { KillerName: 'JungleGap', Assisters: ['Lich'], Stolen: 'False' } },
      { t: 40, name: 'TurretKilled', payload: { KillerName: 'Bot Diff', TurretKilled: 'Turret_T200_R_03_A', Assisters: ['Hook City'] } },
      { t: 40, name: 'FirstBrick', payload: { KillerName: 'Bot Diff' } },
      { t: 48, name: 'DragonKill', payload: { KillerName: 'Kayn Player', DragonType: 'Fire', Stolen: 'False', Assisters: ['Darius Enjoyer'] } },
      { t: 55, name: 'ChampionKill', payload: { KillerName: 'Darius Enjoyer', VictimName: 'Lich', Assisters: ['Kayn Player', 'Syndra Main'] } },
      { t: 63, name: 'ChampionKill', payload: { KillerName: 'Lich', VictimName: 'Jinx Dancer', Assisters: ['Hook City'] } },
      { t: 64, name: 'ChampionKill', payload: { KillerName: 'Lich', VictimName: 'Nautilus Hooks', Assisters: ['Bot Diff'] } },
      { t: 64, name: 'Multikill', payload: { KillerName: 'Lich', KillStreak: 2 } },
      { t: 71, name: 'HeraldKill', payload: { KillerName: 'JungleGap', Stolen: 'False', Assisters: ['Lich', 'Toplaner Tom'] } },
      { t: 80, name: 'DragonKill', payload: { KillerName: 'JungleGap', DragonType: 'Earth', Stolen: 'True', Assisters: ['Lich'] } },
      { t: 88, name: 'ChampionKill', payload: { KillerName: 'Syndra Main', VictimName: 'Lich', Assisters: [] } },
      { t: 96, name: 'BaronKill', payload: { KillerName: 'JungleGap', Stolen: 'False', Assisters: ['Lich', 'Bot Diff', 'Hook City'] } },
      { t: 100, name: 'ChampionKill', payload: { KillerName: 'Lich', VictimName: 'Kayn Player', Assisters: ['JungleGap'] } },
      { t: 101, name: 'ChampionKill', payload: { KillerName: 'Bot Diff', VictimName: 'Darius Enjoyer', Assisters: ['Lich'] } },
      { t: 102, name: 'ChampionKill', payload: { KillerName: 'Hook City', VictimName: 'Syndra Main', Assisters: ['Lich'] } },
      { t: 102, name: 'Ace', payload: { Acer: 'Hook City', AcingTeam: 'ORDER' } },
      { t: 108, name: 'InhibKilled', payload: { KillerName: 'Lich', InhibKilled: 'Barracks_T2_C1', Assisters: ['Bot Diff'] } },
      { t: 114, name: 'GameEnd', payload: { Result: 'Win' } },
    ],
  },
  {
    id: 'g-2026-10-26-jinx',
    gameId: '7311640455',
    queueId: 440,
    gameMode: 'CLASSIC',
    startedAt: '2026-10-26T19:02:41.000Z',
    result: 'loss',
    me: 'Lich',
    myChampion: 'Jinx',
    myRole: 'BOTTOM',
    myTeam: ['Lich', 'Rock Solid', 'Vi Enjoyer', 'Orianna Ball', 'Thresh Lantern'],
    enemies: ['Caitlyn Trap', 'Lux Snipe', 'Lee Sin Kick', 'Garen Spin', 'Azir Soldiers'],
    kda: [4, 7, 6],
    durationS: 116,
    events: [
      { t: 0, name: 'GameStart' },
      { t: 3, name: 'MinionsSpawning' },
      { t: 12, name: 'ChampionKill', payload: { KillerName: 'Lux Snipe', VictimName: 'Lich', Assisters: ['Caitlyn Trap'] } },
      { t: 12, name: 'FirstBlood', payload: { Recipient: 'Lux Snipe' } },
      { t: 20, name: 'ChampionKill', payload: { KillerName: 'Lee Sin Kick', VictimName: 'Lich', Assisters: ['Caitlyn Trap', 'Lux Snipe'] } },
      { t: 29, name: 'HordeKill', payload: { KillerName: 'Lee Sin Kick', Stolen: 'False', Assisters: [] } },
      { t: 36, name: 'ChampionKill', payload: { KillerName: 'Lich', VictimName: 'Caitlyn Trap', Assisters: ['Thresh Lantern'] } },
      { t: 44, name: 'TurretKilled', payload: { KillerName: 'Caitlyn Trap', TurretKilled: 'Turret_T100_R_03_A', Assisters: ['Lux Snipe'] } },
      { t: 44, name: 'FirstBrick', payload: { KillerName: 'Caitlyn Trap' } },
      { t: 52, name: 'DragonKill', payload: { KillerName: 'Lee Sin Kick', DragonType: 'Water', Stolen: 'False', Assisters: ['Garen Spin'] } },
      { t: 53, name: 'ChampionKill', payload: { KillerName: 'Garen Spin', VictimName: 'Lich', Assisters: [] } },
      { t: 61, name: 'ChampionKill', payload: { KillerName: 'Lich', VictimName: 'Lux Snipe', Assisters: ['Orianna Ball'] } },
      { t: 70, name: 'ChampionKill', payload: { KillerName: 'Azir Soldiers', VictimName: 'Lich', Assisters: ['Lee Sin Kick', 'Garen Spin'] } },
      { t: 70, name: 'ChampionKill', payload: { KillerName: 'Garen Spin', VictimName: 'Thresh Lantern', Assisters: ['Azir Soldiers'] } },
      { t: 71, name: 'ChampionKill', payload: { KillerName: 'Lee Sin Kick', VictimName: 'Vi Enjoyer', Assisters: [] } },
      { t: 76, name: 'HeraldKill', payload: { KillerName: 'Lee Sin Kick', Stolen: 'False', Assisters: [] } },
      { t: 84, name: 'ChampionKill', payload: { KillerName: 'Lich', VictimName: 'Lee Sin Kick', Assisters: ['Vi Enjoyer', 'Thresh Lantern'] } },
      { t: 90, name: 'DragonKill', payload: { KillerName: 'Lee Sin Kick', DragonType: 'Water', Stolen: 'False', Assisters: ['Azir Soldiers'] } },
      { t: 92, name: 'ChampionKill', payload: { KillerName: 'Caitlyn Trap', VictimName: 'Lich', Assisters: ['Lux Snipe'] } },
      { t: 99, name: 'BaronKill', payload: { KillerName: 'Lee Sin Kick', Stolen: 'False', Assisters: ['Garen Spin', 'Azir Soldiers'] } },
      { t: 105, name: 'ChampionKill', payload: { KillerName: 'Lich', VictimName: 'Azir Soldiers', Assisters: [] } },
      { t: 108, name: 'ChampionKill', payload: { KillerName: 'Garen Spin', VictimName: 'Lich', Assisters: ['Lee Sin Kick'] } },
      { t: 108, name: 'ChampionKill', payload: { KillerName: 'Caitlyn Trap', VictimName: 'Orianna Ball', Assisters: [] } },
      { t: 109, name: 'ChampionKill', payload: { KillerName: 'Lux Snipe', VictimName: 'Rock Solid', Assisters: ['Caitlyn Trap'] } },
      { t: 109, name: 'Ace', payload: { Acer: 'Lux Snipe', AcingTeam: 'CHAOS' } },
      { t: 112, name: 'InhibKilled', payload: { KillerName: 'Garen Spin', InhibKilled: 'Barracks_T1_C1', Assisters: [] } },
      { t: 116, name: 'GameEnd', payload: { Result: 'Lose' } },
    ],
  },
  {
    id: 'g-2026-10-24-leesin',
    gameId: '7310918820',
    queueId: 400,
    gameMode: 'CLASSIC',
    startedAt: '2026-10-24T23:48:12.000Z',
    result: 'win',
    me: 'Lich',
    myChampion: 'Lee Sin',
    myRole: 'JUNGLE',
    myTeam: ['Lich', 'Shen Taunt', 'Viktor Lasers', 'Ezreal Poke', 'Leona Sun'],
    enemies: ['Graves Cigar', 'Fiora Riposte', 'Zed Shadow', 'Kaisa Evolve', 'Braum Shield'],
    kda: [6, 4, 14],
    durationS: 112,
    events: [
      { t: 0, name: 'GameStart' },
      { t: 3, name: 'MinionsSpawning' },
      { t: 14, name: 'ChampionKill', payload: { KillerName: 'Lich', VictimName: 'Zed Shadow', Assisters: ['Viktor Lasers'] } },
      { t: 14, name: 'FirstBlood', payload: { Recipient: 'Lich' } },
      { t: 24, name: 'HordeKill', payload: { KillerName: 'Lich', Stolen: 'False', Assisters: ['Shen Taunt'] } },
      { t: 33, name: 'ChampionKill', payload: { KillerName: 'Graves Cigar', VictimName: 'Lich', Assisters: ['Fiora Riposte'] } },
      { t: 41, name: 'DragonKill', payload: { KillerName: 'Lich', DragonType: 'Air', Stolen: 'False', Assisters: ['Ezreal Poke', 'Leona Sun'] } },
      { t: 49, name: 'TurretKilled', payload: { KillerName: 'Viktor Lasers', TurretKilled: 'Turret_TChaos_L2_P3_A', Assisters: ['Lich'] } },
      { t: 49, name: 'FirstBrick', payload: { KillerName: 'Viktor Lasers' } },
      { t: 58, name: 'ChampionKill', payload: { KillerName: 'Fiora Riposte', VictimName: 'Lich', Assisters: [] } },
      { t: 66, name: 'HeraldKill', payload: { KillerName: 'Graves Cigar', Stolen: 'False', Assisters: ['Zed Shadow'] } },
      { t: 74, name: 'ChampionKill', payload: { KillerName: 'Lich', VictimName: 'Graves Cigar', Assisters: ['Shen Taunt'] } },
      { t: 75, name: 'ChampionKill', payload: { KillerName: 'Ezreal Poke', VictimName: 'Kaisa Evolve', Assisters: ['Lich', 'Leona Sun'] } },
      { t: 83, name: 'DragonKill', payload: { KillerName: 'Graves Cigar', DragonType: 'Air', Stolen: 'True', Assisters: [] } },
      { t: 84, name: 'ChampionKill', payload: { KillerName: 'Zed Shadow', VictimName: 'Lich', Assisters: ['Graves Cigar'] } },
      { t: 93, name: 'BaronKill', payload: { KillerName: 'Lich', Stolen: 'False', Assisters: ['Shen Taunt', 'Viktor Lasers', 'Ezreal Poke'] } },
      { t: 99, name: 'ChampionKill', payload: { KillerName: 'Lich', VictimName: 'Fiora Riposte', Assisters: ['Shen Taunt'] } },
      { t: 103, name: 'ChampionKill', payload: { KillerName: 'Braum Shield', VictimName: 'Lich', Assisters: ['Kaisa Evolve'] } },
      { t: 104, name: 'ChampionKill', payload: { KillerName: 'Viktor Lasers', VictimName: 'Braum Shield', Assisters: ['Ezreal Poke'] } },
      { t: 105, name: 'ChampionKill', payload: { KillerName: 'Ezreal Poke', VictimName: 'Kaisa Evolve', Assisters: ['Leona Sun'] } },
      { t: 105, name: 'ChampionKill', payload: { KillerName: 'Shen Taunt', VictimName: 'Zed Shadow', Assisters: ['Viktor Lasers'] } },
      { t: 106, name: 'ChampionKill', payload: { KillerName: 'Leona Sun', VictimName: 'Graves Cigar', Assisters: ['Ezreal Poke'] } },
      { t: 106, name: 'Ace', payload: { Acer: 'Leona Sun', AcingTeam: 'ORDER' } },
      { t: 112, name: 'GameEnd', payload: { Result: 'Win' } },
    ],
  },
];

const OBJECTIVE_NAMES = new Set(['DragonKill', 'HordeKill', 'HeraldKill', 'BaronKill', 'AtakhanKill']);
const TOWER_NAMES = new Set(['TurretKilled', 'InhibKilled']);
/** Events folded into their twin (FirstBlood -> ChampionKill, FirstBrick -> TurretKilled). */
const FOLDED = new Set(['FirstBlood', 'FirstBrick', 'Multikill']);

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function classify(name: string, payload: Record<string, unknown>, me: string, myTeam: Set<string>): { kind: MarkerKind; lane: Lane } {
  const killer = typeof payload['KillerName'] === 'string' ? payload['KillerName'] : '';
  const victim = typeof payload['VictimName'] === 'string' ? payload['VictimName'] : '';
  const assisters = strArr(payload['Assisters']);
  const involved = killer === me || victim === me || assisters.includes(me);
  const lane: Lane = involved ? 'mine' : 'team';
  if (name === 'ChampionKill') {
    if (victim === me) return { kind: 'own_death', lane: 'mine' };
    if (killer === me) return { kind: 'own_kill', lane: 'mine' };
    if (assisters.includes(me)) return { kind: 'own_assist', lane: 'mine' };
    return { kind: 'other', lane: 'team' };
  }
  if (OBJECTIVE_NAMES.has(name)) return { kind: 'objective', lane };
  if (TOWER_NAMES.has(name)) return { kind: 'tower', lane };
  if (name === 'Ace') {
    const acer = typeof payload['Acer'] === 'string' ? payload['Acer'] : '';
    return { kind: 'ace', lane: acer === me || myTeam.has(acer) ? 'mine' : 'team' };
  }
  return { kind: 'other', lane: 'team' };
}

function champOf(name: string, spec: GameSpec): string {
  // Mock: riot id -> champion is not modelled; show the riot id without the suffix.
  return name === spec.me ? spec.myChampion : name.split(' ')[0] ?? name;
}

function buildEvents(spec: GameSpec, segmentId: string): EventRow[] {
  const myTeam = new Set(spec.myTeam);
  return spec.events.map((e, i) => {
    const payload = { EventID: i, EventName: e.name, EventTime: e.t, ...(e.payload ?? {}) };
    const { kind, lane } = classify(e.name, payload, spec.me, myTeam);
    return {
      id: `${spec.id}-e${i}`,
      gameId: spec.id,
      eventId: i,
      name: e.name,
      gameTimeS: e.t,
      videoSegmentId: segmentId,
      videoTMs: Math.round((e.t + LOADING_OFFSET_S) * 1000),
      payload,
      kind,
      lane,
    };
  });
}

const STAKES: Record<string, number> = { BaronKill: 0.9, AtakhanKill: 0.8, DragonKill: 0.5, HeraldKill: 0.4, HordeKill: 0.3 };

/** Scaled-down §3.6 v1: cluster, score, title. */
function buildMoments(spec: GameSpec, events: EventRow[], segmentId: string, durationMs: number): Moment[] {
  const myTeam = new Set(spec.myTeam);
  const relevant = events.filter((e) => e.kind !== 'other' && !FOLDED.has(e.name) && !['GameStart', 'GameEnd', 'MinionsSpawning'].includes(e.name));
  const clusters: EventRow[][] = [];
  for (const e of relevant) {
    const last = clusters[clusters.length - 1];
    if (last && e.gameTimeS - (last[last.length - 1]?.gameTimeS ?? 0) <= CLUSTER_S) last.push(e);
    else clusters.push([e]);
  }
  const moments: Moment[] = clusters.map((cluster, idx) => {
    const first = cluster[0]!;
    const last = cluster[cluster.length - 1]!;
    // Pick the anchor event: own death > ace > objective > own kill > tower > assist.
    const prio: Record<MarkerKind, number> = { own_death: 6, ace: 5, objective: 4, own_kill: 3, tower: 2, own_assist: 1, other: 0 };
    const anchor = [...cluster].sort((a, b) => prio[b.kind] - prio[a.kind])[0]!;
    const deaths = cluster.filter((e) => e.kind === 'own_death');
    const kills = cluster.filter((e) => e.kind === 'own_kill');
    const assists = cluster.filter((e) => e.kind === 'own_assist');
    const champKills = cluster.filter((e) => e.name === 'ChampionKill').length;
    const objectives = cluster.filter((e) => e.kind === 'objective');
    const mine = cluster.some((e) => e.lane === 'mine');

    let score = 0;
    const reasons: string[] = [];
    let kind: MomentKind = 'kill';
    let theme: Theme = 'kills';
    let title = '';
    const gt = fmtGameTime(anchor.gameTimeS);
    const payload = anchor.payload;
    const killer = String(payload['KillerName'] ?? '');
    const assisters = strArr(payload['Assisters']);

    if (deaths.length) {
      const d = deaths[0]!;
      const dk = String(d.payload['KillerName'] ?? '');
      const da = strArr(d.payload['Assisters']);
      score += 1.0;
      theme = 'deaths';
      if (champKills >= 3) {
        kind = 'teamfight_death';
        title = `Died in a teamfight, ${gt}`;
        reasons.push(`${champKills} kills within ${CLUSTER_S} s: teamfight`);
      } else if (da.length === 0) {
        kind = 'solo_death';
        title = `Solo death to ${champOf(dk, spec)}, ${gt}`;
        reasons.push('No assisters: 1v1 loss or caught alone');
      } else {
        kind = 'gank_death';
        title = `Collapsed on by ${1 + da.length}, ${gt}`;
        reasons.push(`Killed by ${champOf(dk, spec)} + ${da.map((a) => champOf(a, spec)).join(', ')}`);
      }
      if (anchor.gameTimeS < 60) {
        score += 0.15;
        reasons.push('Early death (laning phase weighs more)');
      }
      const followUp = events.find((e) => e.kind === 'objective' && e.lane === 'team' && e.gameTimeS > d.gameTimeS && e.gameTimeS - d.gameTimeS <= 20 && !myTeam.has(String(e.payload['KillerName'])));
      if (followUp) {
        score += 0.2;
        reasons.push(`Enemy took ${objectiveLabel(followUp)} ${Math.round(followUp.gameTimeS - d.gameTimeS)} s later: death traded into objective`);
      }
      const teamGain = cluster.find((e) => (e.kind === 'objective' || e.kind === 'tower') && myTeam.has(String(e.payload['KillerName'])));
      if (teamGain) reasons.push(`Team took ${objectiveLabel(teamGain)} in the same window (sacrifice?)`);
      else if (!kills.length && !assists.length && champKills === 1) reasons.push('Nothing followed: likely a meaningless death');
    } else if (cluster.some((e) => e.kind === 'ace')) {
      kind = 'ace';
      theme = 'teamfights';
      score += 0.6;
      const ace = cluster.find((e) => e.kind === 'ace')!;
      const ours = ace.lane === 'mine';
      title = `${ours ? 'We aced them' : 'We got aced'}, ${gt}`;
      reasons.push(`${champKills} kills in the fight`);
      if (kills.length) reasons.push(`You got ${kills.length} kill${kills.length > 1 ? 's' : ''}`);
    } else if (objectives.length) {
      const o = objectives[0]!;
      const stolen = String(o.payload['Stolen']) === 'True';
      const ours = myTeam.has(String(o.payload['KillerName']));
      kind = stolen ? 'objective_steal' : 'objective';
      theme = 'objectives';
      score += 0.3 + (STAKES[o.name] ?? 0.3) * 0.5;
      title = `${ours ? 'Took' : 'Lost'} ${objectiveLabel(o)}${stolen ? ' (stolen!)' : ''}, ${gt}`;
      reasons.push(`${objectiveLabel(o)}: ${ours ? 'our' : 'enemy'} ${stolen ? 'steal' : 'secure'}`);
      if (stolen) {
        score += 0.25;
        reasons.push('Steals are swing moments');
      }
      if (o.lane === 'mine') reasons.push('You participated');
    } else if (kills.length >= 2) {
      kind = 'multikill';
      theme = 'kills';
      score += 0.6 + 0.1 * kills.length;
      title = `${kills.length === 2 ? 'Double' : 'Multi'} kill, ${gt}`;
      reasons.push(`${kills.length} kills in ${CLUSTER_S} s`);
    } else if (kills.length === 1) {
      kind = 'kill';
      theme = 'kills';
      score += 0.6;
      title = `Killed ${champOf(String(kills[0]!.payload['VictimName']), spec)}, ${gt}`;
      if (assisters.length === 0 && killer === spec.me) reasons.push('Solo kill: what made it work?');
      else reasons.push('Kill with help from your team');
    } else if (cluster.some((e) => e.kind === 'tower')) {
      kind = 'tower';
      theme = 'objectives';
      score += 0.35;
      const t = cluster.find((e) => e.kind === 'tower')!;
      const ours = myTeam.has(String(t.payload['KillerName']));
      title = `${ours ? 'Took' : 'Lost'} ${t.name === 'InhibKilled' ? 'inhibitor' : 'tower'}, ${gt}`;
      reasons.push(t.lane === 'mine' ? 'You participated' : 'Team play');
    } else {
      theme = 'kills';
      score += 0.4;
      title = `Assist, ${gt}`;
      reasons.push('You assisted a kill');
    }
    score += Math.min(0.15, 0.03 * cluster.length);
    score = Math.min(1, Math.round(score * 100) / 100);

    const tTriggerMs = anchor.videoTMs;
    const tStartMs = Math.max(0, first.videoTMs - PRE_ROLL_S * 1000);
    const tEndMs = Math.min(durationMs, last.videoTMs + POST_ROLL_S * 1000);
    return {
      id: `${spec.id}-m${idx}`,
      gameId: spec.id,
      kind,
      score,
      segmentId,
      tStartMs,
      tTriggerMs,
      tEndMs,
      triggerGameTimeS: anchor.gameTimeS,
      title,
      reasons,
      theme,
      mine,
      eventIds: cluster.map((e) => e.id),
      reviewedAt: null,
      tags: [],
    };
  });
  return moments.sort((a, b) => b.score - a.score || a.tTriggerMs - b.tTriggerMs);
}

function objectiveLabel(e: EventRow): string {
  switch (e.name) {
    case 'DragonKill':
      return `${String(e.payload['DragonType'] ?? '')} drake`.trim();
    case 'HordeKill':
      return 'voidgrubs';
    case 'HeraldKill':
      return 'Herald';
    case 'BaronKill':
      return 'Baron';
    case 'AtakhanKill':
      return 'Atakhan';
    case 'TurretKilled':
      return 'a tower';
    case 'InhibKilled':
      return 'an inhibitor';
    default:
      return e.name;
  }
}

function fmtGameTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

interface PersistedState {
  notes: Note[];
  tags: Record<string, CauseTag[]>;
  reviewed: Record<string, string>;
  clips: Clip[];
}

export interface MockBackendOptions {
  sampleVideo: string;
  statePath: string;
  mediaRoots: string[];
}

export class MockBackend implements Backend {
  private games = new Map<string, GameBundle>();
  private state: PersistedState = { notes: [], tags: {}, reviewed: {}, clips: [] };
  private status: RecorderStatus = {
    state: 'idle',
    gameId: null,
    sinceIso: null,
    encoder: null,
    frames: 0,
    dropped: 0,
    enabled: true,
    detail: 'mock recorder',
  };
  private listeners = new Set<(s: RecorderStatus) => void>();
  private timer: NodeJS.Timeout | null = null;
  private cyclePhaseStart = Date.now();
  private settings: Settings | null = null;

  constructor(private readonly opts: MockBackendOptions) {}

  async start(): Promise<void> {
    this.loadState();
    let sizeBytes = 0;
    try {
      sizeBytes = statSync(this.opts.sampleVideo).size;
    } catch {
      sizeBytes = 0;
    }
    for (const spec of GAME_SPECS) {
      const segmentId = `${spec.id}-s0`;
      const durationMs = 120_000;
      const segment = {
        id: segmentId,
        gameId: spec.id,
        index: 0,
        path: this.opts.sampleVideo,
        qpcStart: 0,
        wallStart: spec.startedAt,
        durationMs,
        width: 1920,
        height: 1080,
        fps: 60,
        codec: 'h264',
        sizeBytes,
      };
      const events = buildEvents(spec, segmentId);
      const moments = buildMoments(spec, events, segmentId, durationMs);
      const game: Game = {
        id: spec.id,
        gameId: spec.gameId,
        platform: 'LA1',
        queueId: spec.queueId,
        queueName: queueName(spec.queueId),
        gameMode: spec.gameMode,
        patch: '26.21',
        startedAt: spec.startedAt,
        endedAt: new Date(Date.parse(spec.startedAt) + spec.durationS * 1000).toISOString(),
        result: spec.result,
        myPuuid: 'mock-puuid',
        myChampion: spec.myChampion,
        myRole: spec.myRole,
        durationS: spec.durationS,
        status: 'ready',
        kills: spec.kda[0],
        deaths: spec.kda[1],
        assists: spec.kda[2],
        sizeBytes,
        reviewStatus: 'unreviewed',
        pinned: false,
      };
      this.games.set(spec.id, { game, segments: [segment], events, moments, notes: [], clips: [] });
    }
    this.timer = setInterval(() => this.tick(), 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async listGames(): Promise<Game[]> {
    return [...this.games.values()]
      .map((b) => this.decorate(b).game)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }

  async getGame(id: string): Promise<GameBundle | null> {
    const b = this.games.get(id);
    return b ? this.decorate(b) : null;
  }

  async saveNote(input: NoteInput): Promise<Note> {
    if (!this.games.has(input.gameId)) throw new Error(`unknown game ${input.gameId}`);
    const text = String(input.text ?? '').slice(0, 4000);
    let note: Note;
    const existing = input.id ? this.state.notes.find((n) => n.id === input.id) : undefined;
    if (existing) {
      existing.text = text;
      existing.videoTMs = input.videoTMs;
      existing.momentId = input.momentId;
      note = existing;
    } else {
      note = {
        id: `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        gameId: input.gameId,
        momentId: input.momentId,
        videoTMs: Math.max(0, Math.round(input.videoTMs)),
        text,
        createdAt: new Date().toISOString(),
      };
      this.state.notes.push(note);
    }
    if (note.momentId && text.trim()) this.state.reviewed[note.momentId] ??= new Date().toISOString();
    this.saveState();
    return { ...note };
  }

  async deleteNote(id: string): Promise<void> {
    this.state.notes = this.state.notes.filter((n) => n.id !== id);
    this.saveState();
  }

  async setTags(momentId: string, tags: CauseTag[]): Promise<void> {
    const clean = [...new Set(tags.filter((t): t is CauseTag => (CAUSE_TAGS as readonly string[]).includes(t)))];
    this.state.tags[momentId] = clean;
    if (clean.length) this.state.reviewed[momentId] ??= new Date().toISOString();
    this.saveState();
  }

  async markReviewed(momentId: string): Promise<void> {
    this.state.reviewed[momentId] = new Date().toISOString();
    this.saveState();
  }

  async getClip(id: string): Promise<ClipBundle | null> {
    const clip = this.state.clips.find((c) => c.id === id);
    const b = clip ? this.games.get(clip.gameId) : undefined;
    const segment = b?.segments[0];
    if (!clip || !b || !segment) return null;
    return { clip: { ...clip }, game: this.decorate(b).game, segment, events: b.events };
  }

  async updateClip(id: string, patch: Partial<Pick<Clip, 'title' | 'description' | 'tInMs' | 'tOutMs' | 'path' | 'drawings'>>): Promise<Clip> {
    const clip = this.state.clips.find((c) => c.id === id);
    if (!clip) throw new Error(`unknown clip ${id}`);
    Object.assign(clip, patch);
    this.saveState();
    return { ...clip };
  }

  async deleteClip(id: string): Promise<Clip | null> {
    const clip = this.state.clips.find((c) => c.id === id) ?? null;
    this.state.clips = this.state.clips.filter((c) => c.id !== id);
    this.saveState();
    return clip;
  }

  async addClip(clip: Omit<Clip, 'id' | 'createdAt' | 'drawings' | 'description'>): Promise<Clip> {
    const row: Clip = { description: '', drawings: [], ...clip, id: `c-${Date.now().toString(36)}`, createdAt: new Date().toISOString() };
    this.state.clips.push(row);
    this.saveState();
    return { ...row };
  }

  getRecorderStatus(): RecorderStatus {
    return { ...this.status };
  }

  onRecorderStatus(cb: (s: RecorderStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    if (this.status.enabled !== s.recordingEnabled) {
      this.status = { ...this.status, enabled: s.recordingEnabled, state: 'idle', gameId: null, sinceIso: null, detail: s.recordingEnabled ? 'mock recorder' : 'recording disabled' };
      this.cyclePhaseStart = Date.now();
      this.emit();
    }
  }

  mediaRoots(): string[] {
    return this.opts.mediaRoots;
  }

  /** Fake lifecycle: idle 40 s -> recording 20 s -> post-processing 6 s -> idle. */
  private tick(): void {
    if (!this.status.enabled) return;
    const elapsed = (Date.now() - this.cyclePhaseStart) / 1000;
    const s = this.status;
    if (s.state === 'idle' && elapsed >= 40) {
      this.status = { ...s, state: 'recording', gameId: 'live-mock', sinceIso: new Date().toISOString(), encoder: 'h264_nvenc', frames: 0, dropped: 0, detail: 'mock game in progress' };
      this.cyclePhaseStart = Date.now();
      this.emit();
    } else if (s.state === 'recording') {
      if (elapsed >= 20) {
        this.status = { ...s, state: 'post_processing', detail: 'remux · thumbnails · moments' };
        this.cyclePhaseStart = Date.now();
      } else {
        this.status = { ...s, frames: s.frames + 60, dropped: s.dropped + (Math.random() < 0.05 ? 1 : 0) };
      }
      this.emit();
    } else if (s.state === 'post_processing' && elapsed >= 6) {
      this.status = { ...s, state: 'idle', gameId: null, sinceIso: null, encoder: null, detail: 'mock recorder' };
      this.cyclePhaseStart = Date.now();
      this.emit();
    }
  }

  private emit(): void {
    for (const l of this.listeners) l(this.getRecorderStatus());
  }

  /** Overlay persisted notes/tags/clips/reviewed state on the immutable fixtures. */
  private decorate(b: GameBundle): GameBundle {
    const moments = b.moments.map((m) => ({
      ...m,
      tags: this.state.tags[m.id] ?? [],
      reviewedAt: this.state.reviewed[m.id] ?? null,
    }));
    const reviewedCount = moments.filter((m) => m.reviewedAt).length;
    const reviewStatus = reviewedCount === 0 ? 'unreviewed' : reviewedCount >= Math.min(5, moments.length) ? 'reviewed' : 'in_progress';
    return {
      game: { ...b.game, reviewStatus },
      segments: b.segments,
      events: b.events,
      moments,
      notes: this.state.notes.filter((n) => n.gameId === b.game.id),
      clips: this.state.clips.filter((c) => c.gameId === b.game.id),
    };
  }

  private loadState(): void {
    try {
      const raw = JSON.parse(readFileSync(this.opts.statePath, 'utf8')) as Partial<PersistedState>;
      this.state = {
        notes: Array.isArray(raw.notes) ? raw.notes : [],
        tags: raw.tags && typeof raw.tags === 'object' ? raw.tags : {},
        reviewed: raw.reviewed && typeof raw.reviewed === 'object' ? raw.reviewed : {},
        clips: Array.isArray(raw.clips) ? raw.clips.map((c) => ({ ...c, title: c.title ?? '', description: c.description ?? '', drawings: c.drawings ?? [] })) : [],
      };
    } catch {
      /* first run */
    }
  }

  private saveState(): void {
    try {
      mkdirSync(dirname(this.opts.statePath), { recursive: true });
      writeFileSync(this.opts.statePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.error('[mock] state save failed', err);
    }
  }
}
