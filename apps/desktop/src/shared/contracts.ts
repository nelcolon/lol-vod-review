/**
 * Plain TypeScript contracts shared by main, preload and renderer.
 *
 * These mirror the SQLite schema in docs/PLAN.md §3.5 and the moments engine in §3.6.
 * They are intentionally zod-free and dependency-free: the renderer only ever sees these
 * shapes through the typed `window.lvr` bridge. When `@lvr/core` lands, its row types should
 * be mapped onto these (or replace them) at the `Backend` seam in `src/main/backend.ts`.
 *
 * Time conventions:
 *   - `gameTimeS`  = seconds on the Live Client clock (0 at the `GameStart` event).
 *   - `*Ms`        = milliseconds of *video* time inside a segment (what `<video>.currentTime` uses).
 *   The two clocks differ (loading screen, pauses); the clock mapper in core produces `videoTMs`.
 */

export type GameResult = 'win' | 'loss' | 'remake' | 'unknown';
export type GameStatus = 'recording' | 'post_processing' | 'ready' | 'failed';
export type ReviewStatus = 'unreviewed' | 'in_progress' | 'reviewed';

/** Enemy positions shown against each of mine: lane opponent first. */
export const OPPONENT_ROLES: Record<string, string[]> = {
  TOP: ['TOP', 'JUNGLE'],
  JUNGLE: ['JUNGLE', 'MIDDLE'],
  MIDDLE: ['MIDDLE', 'JUNGLE'],
  BOTTOM: ['BOTTOM', 'UTILITY'],
  UTILITY: ['UTILITY', 'BOTTOM'],
};

export interface Game {
  id: string;
  /** Riot gameId (numeric, stringified to avoid 64-bit issues). */
  gameId: string;
  platform: string;
  queueId: number;
  /** Human label for the queue derived from queueId (e.g. "Ranked Solo/Duo"). */
  queueName: string;
  gameMode: string;
  patch: string;
  startedAt: string; // ISO
  endedAt: string | null; // ISO
  result: GameResult;
  myPuuid: string;
  myChampion: string;
  /** Data Dragon champion id for the icon ('' when unknown). */
  myChampionKey: string;
  myRole: string;
  /**
   * Enemies that matter for my position: the lane opponent first, then their support (bot),
   * their ADC (support), their jungler (top/mid) or their mid (jungle). Empty when unknown.
   */
  opponents: Array<{ champion: string; championKey: string; role: string }>;
  /** My partner on my team (support for bot, ADC for support, jungler for top/mid, mid for jungle). */
  allies: Array<{ champion: string; championKey: string; role: string }>;
  /** Data Dragon version for champion icons; null offline. */
  iconVersion: string | null;
  durationS: number;
  status: GameStatus;
  kills: number;
  deaths: number;
  assists: number;
  /** Sum of all segment sizes in bytes. */
  sizeBytes: number;
  reviewStatus: ReviewStatus;
  pinned: boolean;
}

export interface Segment {
  id: string;
  gameId: string;
  /** Index of the segment inside the game (0-based; >0 only after reconnects). */
  index: number;
  /** Absolute path on disk. Served to the renderer through `lvr-media://`. */
  path: string;
  qpcStart: number;
  wallStart: string; // ISO
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  sizeBytes: number;
}

/** The 17 Live Client event names (PLAN §2.2). Unknown names pass through as strings. */
export type LiveEventName =
  | 'GameStart'
  | 'MinionsSpawning'
  | 'FirstBlood'
  | 'ChampionKill'
  | 'Multikill'
  | 'Ace'
  | 'FirstBrick'
  | 'TurretKilled'
  | 'InhibKilled'
  | 'InhibRespawningSoon'
  | 'InhibRespawned'
  | 'DragonKill'
  | 'HordeKill'
  | 'HeraldKill'
  | 'BaronKill'
  | 'AtakhanKill'
  | 'GameEnd'
  | (string & {});

/** How an event is drawn on the marker timeline. */
export type MarkerKind =
  | 'own_death'
  | 'own_kill'
  | 'own_assist'
  | 'objective'
  | 'tower'
  | 'ace'
  | 'other';

export type Lane = 'mine' | 'team';

export interface EventRow {
  id: string;
  gameId: string;
  /** Live Client `EventID` (dedupe key). */
  eventId: number;
  name: LiveEventName;
  gameTimeS: number;
  videoSegmentId: string;
  /** Video time inside the segment, produced by the clock mapper. */
  videoTMs: number;
  /** Raw Live Client payload (KillerName, VictimName, Assisters, Stolen, ...). */
  payload: Record<string, unknown>;
  /** Derived by the event normalizer: how to colour the marker. */
  kind: MarkerKind;
  /** Derived: did I (my champion) participate? */
  lane: Lane;
}

export type MomentKind =
  | 'solo_death'
  | 'gank_death'
  | 'teamfight_death'
  | 'kill'
  | 'multikill'
  | 'objective'
  | 'objective_steal'
  | 'tower'
  | 'ace';

export type Theme = 'deaths' | 'objectives' | 'kills' | 'teamfights';

export const CAUSE_TAGS = [
  'positioning',
  'decision',
  'skill',
  'vision',
  'cooldowns',
  'map-awareness',
  'sacrifice',
  'meaningless',
] as const;
export type CauseTag = (typeof CAUSE_TAGS)[number];

export interface Moment {
  id: string;
  gameId: string;
  kind: MomentKind;
  /** 0..1, higher = review first. */
  score: number;
  segmentId: string;
  /** Window start (pre-roll applied). Clicking a moment seeks here. */
  tStartMs: number;
  /** The event that triggered the moment (first event of the cluster). */
  tTriggerMs: number;
  tEndMs: number;
  /** Live Client game time of the trigger, for the title ("11:42"). */
  triggerGameTimeS: number;
  title: string;
  /** Why it ranked (human-readable bullets). */
  reasons: string[];
  theme: Theme;
  /** Whether I was directly involved (killer / victim / assister). */
  mine: boolean;
  /** Event ids that make up this cluster. */
  eventIds: string[];
  reviewedAt: string | null;
  tags: CauseTag[];
}

export interface Note {
  id: string;
  gameId: string;
  momentId: string | null;
  videoTMs: number;
  text: string;
  createdAt: string; // ISO
}

export interface NoteInput {
  id?: string; // present => update
  gameId: string;
  momentId: string | null;
  videoTMs: number;
  text: string;
}

export interface Clip {
  id: string;
  gameId: string;
  segmentId: string;
  /** Range on the game video (segment ms). The clip window plays the original video in this range. */
  tInMs: number;
  tOutMs: number;
  /** The cut MP4 (re-cut when the range changes). */
  path: string;
  createdAt: string;
  pinned: boolean;
  title: string;
  description: string;
  drawings: Drawing[];
}

export type DrawTool = 'arrow' | 'circle' | 'pen';

/** Points are normalized to the video frame: [0,0] top-left, [1,1] bottom-right. */
export interface DrawShape {
  tool: DrawTool;
  color: string;
  points: Array<[number, number]>;
}

/** A telestrator frame: shapes shown from `tMs` (game video ms) for `holdMs`. */
export interface Drawing {
  id: string;
  tMs: number;
  holdMs: number;
  shapes: DrawShape[];
}

export interface ClipPatch {
  title?: string;
  description?: string;
  tInMs?: number;
  tOutMs?: number;
  drawings?: Drawing[];
}

/** Everything the clip window needs. */
export interface ClipBundle {
  clip: Clip;
  game: Game;
  segment: Segment;
  /** Events of the game (the window shows those near the clip range). */
  events: EventRow[];
}

/** One inventory entry, enriched from Data Dragon. */
export interface PlayItem {
  id: number;
  name: string;
  count: number;
  /** Total item cost (one unit) from Data Dragon; 0 when unknown. */
  gold: number;
}

export interface PlayItemChange {
  id: number;
  name: string;
  /** Units used, bought or sold. */
  count: number;
  /** Game time (s) it was bought, for purchases; null otherwise. */
  t: number | null;
}

export interface PlayKill {
  champion: string;
  /** Data Dragon champion id for the icon; '' for turrets, minions, monsters. */
  championKey: string;
  t: number;
}

/** Item gold compared with the enemy in the same position. */
export interface PlayVs {
  champion: string;
  championKey: string;
  /** This player's item gold minus theirs. */
  diff: number;
}

export type PlayRole = 'killer' | 'victim' | 'assist';

export interface PlayPlayer {
  name: string;
  champion: string;
  /** Data Dragon champion id for the icon ('' when unknown). */
  championKey: string;
  team: 'ORDER' | 'CHAOS';
  isMe: boolean;
  roles: PlayRole[];
  level: number;
  levelBefore: number;
  kills: number;
  deaths: number;
  assists: number;
  /** Inventory at the trigger (the death/kill). */
  items: PlayItem[];
  /** Sum of item costs at the trigger, wards and consumables excluded. */
  itemGold: number;
  spells: Array<{ name: string; key: string }>;
  /** Used during the play: potions, elixirs, Control Wards, Stopwatch. */
  used: PlayItemChange[];
  /** Bought during the play (components that went into them are left out). */
  bought: PlayItemChange[];
  /** Gone without a purchase: sold. */
  sold: PlayItemChange[];
  /** Champions this player killed in the play, with game time (s). */
  killed: PlayKill[];
  /** Who killed this player in the play (champion, or Turret/Minion/…). */
  killedBy: PlayKill[];
  /** Lane opponent comparison, null when positions are unknown. */
  vs: PlayVs | null;
  /** Total gold earned at the last full minute (League client timeline), null when unavailable. */
  totalGold: number | null;
}

/** Everyone's state around one moment. */
export interface PlayState {
  momentId: string;
  triggerS: number;
  beforeS: number;
  afterS: number;
  /** Data Dragon version for icons, null when offline. */
  ddragonVersion: string | null;
  /** False for games recorded before items were saved (only minute gold is shown then). */
  hasItems: boolean;
  /** Your unspent gold at the trigger, when recorded. */
  myGold: number | null;
  /** Minute of the League client timeline frame used for gold, null when unavailable. */
  goldMinute: number | null;
  players: PlayPlayer[];
}

export type BitratePreset = '1080p60_12' | '1080p30_8' | '1440p60_20';

export const BITRATE_PRESETS: Record<BitratePreset, { label: string; width: number; height: number; fps: number; mbps: number }> = {
  '1080p60_12': { label: '1080p60 · 12 Mbps (default)', width: 1920, height: 1080, fps: 60, mbps: 12 },
  '1080p30_8': { label: '1080p30 · 8 Mbps (laptops)', width: 1920, height: 1080, fps: 30, mbps: 8 },
  '1440p60_20': { label: '1440p60 · 20 Mbps', width: 2560, height: 1440, fps: 60, mbps: 20 },
};

/** Riot queueIds we offer to record. Off by default: Practice Tool, custom, Arena/Brawl, spectate. */
/** Settings `queues` entry standing for every mode without its own checkbox. */
export const OTHER_MODES = -1;
/** Bumped when a new default-on entry is added, so existing settings get it once. */
export const QUEUE_LIST_VERSION = 2;

export const RECORDABLE_QUEUES: ReadonlyArray<{ id: number; label: string; defaultOn: boolean }> = [
  { id: 420, label: 'Ranked Solo/Duo', defaultOn: true },
  { id: 440, label: 'Ranked Flex', defaultOn: true },
  { id: 400, label: 'Normal Draft', defaultOn: true },
  { id: 430, label: 'Normal Blind', defaultOn: true },
  { id: 490, label: 'Quickplay', defaultOn: true },
  { id: 450, label: 'ARAM (incl. ARAM: Mayhem)', defaultOn: true },
  { id: 1700, label: 'Arena', defaultOn: false },
  { id: 0, label: 'Custom games', defaultOn: false },
  { id: 3140, label: 'Practice Tool', defaultOn: false },
  /** Not a queue: any mode not listed above (URF, One for All, modes Riot adds later). */
  { id: OTHER_MODES, label: 'Other and new modes (URF, One for All…)', defaultOn: true },
];

/** Names for queues that have no checkbox of their own. */
const QUEUE_NAMES: Record<number, string> = {
  450: 'ARAM',
  480: 'Swiftplay',
  700: 'Clash',
  720: 'ARAM Clash',
  900: 'URF',
  1020: 'One for All',
  1900: 'URF',
  2400: 'ARAM: Mayhem',
};

export interface Settings {
  recordingEnabled: boolean;
  quotaGb: number;
  bitratePreset: BitratePreset;
  /** queueIds enabled for recording. */
  queues: number[];
  /** Seconds of video before a moment's trigger when jumping to it (5-90). */
  preRollS: number;
  /** Mix the default microphone into the recording's audio. */
  recordMic: boolean;
  /** Mic gain in percent (0-300). */
  micVolume: number;
  /**
   * Record with Windows Graphics Capture instead of DXGI Desktop Duplication. WGC makes
   * Windows compose the game (more latency, lower 1% lows); only for PCs where duplication
   * misbehaves. The recorder falls back to WGC by itself when duplication cannot start.
   */
  compatCapture: boolean;
  autostart: boolean;
  minimizeToTray: boolean;
  /** QUEUE_LIST_VERSION these settings were last migrated to. */
  queueListVersion: number;
}

export const DEFAULT_SETTINGS: Settings = {
  recordingEnabled: true,
  quotaGb: 50,
  bitratePreset: '1080p60_12',
  queues: RECORDABLE_QUEUES.filter((q) => q.defaultOn).map((q) => q.id),
  preRollS: 10,
  recordMic: true,
  micVolume: 100,
  compatCapture: false,
  autostart: false,
  minimizeToTray: true,
  queueListVersion: QUEUE_LIST_VERSION,
};

export type RecorderState = 'idle' | 'recording' | 'post_processing';

export interface UpdateStatus {
  /** dev = not an installed build; latest = up to date; ready = downloaded, restart to install. */
  state: 'idle' | 'dev' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error';
  current: string;
  latest: string | null;
  percent: number | null;
  error: string | null;
}

export interface RecorderStatus {
  state: RecorderState;
  /** Game currently being recorded / processed. */
  gameId: string | null;
  sinceIso: string | null;
  encoder: string | null;
  frames: number;
  dropped: number;
  /** Recording disabled by the user (tray toggle / settings). */
  enabled: boolean;
  /** Free-form detail for the status bar ("remuxing", "waiting for LCU", ...). */
  detail: string | null;
  /** Bumped when stored games change outside a recording (e.g. a result filled in later). */
  libraryRev?: number;
}

export interface GameBundle {
  game: Game;
  segments: Segment[];
  events: EventRow[];
  moments: Moment[];
  notes: Note[];
  clips: Clip[];
}

export interface ClipExportResult {
  ok: boolean;
  clip: Clip | null;
  error: string | null;
}

export function queueName(queueId: number): string {
  return QUEUE_NAMES[queueId] ?? RECORDABLE_QUEUES.find((q) => q.id === queueId && q.id !== OTHER_MODES)?.label ?? `Queue ${queueId}`;
}
