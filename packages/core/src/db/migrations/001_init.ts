/**
 * Migration 1: initial schema (PLAN §3.5).
 *
 * Deviations from the plan, all additive:
 *  - games.pinned (retention exemption), games.reviewed_at, games.created_at
 *  - segments.seq (segment order within a game)
 *  - moments.t_start_s / t_trigger_s / t_end_s (game-time window; video ms may be null),
 *    moments.labels_json, moments.score_json (component breakdown)
 *  - child tables reference games.id (INTEGER); games.game_id is the Riot game id (TEXT).
 */
export const version = 1;
export const name = 'init';
export const sql = `
CREATE TABLE games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       TEXT    NOT NULL UNIQUE,
  platform      TEXT,
  queue_id      INTEGER,
  game_mode     TEXT,
  patch         TEXT,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  result        TEXT,
  my_puuid      TEXT,
  my_champion   TEXT,
  my_role       TEXT,
  duration_s    REAL,
  status        TEXT    NOT NULL DEFAULT 'recording',
  pinned        INTEGER NOT NULL DEFAULT 0,
  reviewed_at   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX games_started_at ON games(started_at DESC);
CREATE INDEX games_status ON games(status);

CREATE TABLE segments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  path        TEXT    NOT NULL,
  qpc_start   INTEGER,
  wall_start  INTEGER,
  duration_ms INTEGER,
  width       INTEGER,
  height      INTEGER,
  fps         REAL,
  codec       TEXT,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(game_id, seq)
);

CREATE TABLE participants (
  game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot          INTEGER NOT NULL,
  riot_id_name  TEXT    NOT NULL,
  puuid         TEXT,
  team          TEXT    NOT NULL,
  champion      TEXT,
  role          TEXT,
  PRIMARY KEY (game_id, slot)
);

CREATE TABLE events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id          INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  event_id         INTEGER NOT NULL,
  name             TEXT    NOT NULL,
  game_time_s      REAL    NOT NULL,
  video_segment_id INTEGER REFERENCES segments(id) ON DELETE SET NULL,
  video_t_ms       REAL,
  payload_json     TEXT    NOT NULL DEFAULT '{}',
  UNIQUE(game_id, event_id)
);
CREATE INDEX events_game_time ON events(game_id, game_time_s);

CREATE TABLE moments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  moment_key    TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  theme         TEXT    NOT NULL,
  score         REAL    NOT NULL,
  t_start_s     REAL    NOT NULL,
  t_trigger_s   REAL    NOT NULL,
  t_end_s       REAL    NOT NULL,
  segment_id    INTEGER REFERENCES segments(id) ON DELETE SET NULL,
  t_start_ms    REAL,
  t_trigger_ms  REAL,
  t_end_ms      REAL,
  title         TEXT    NOT NULL,
  reason_json   TEXT    NOT NULL DEFAULT '[]',
  labels_json   TEXT    NOT NULL DEFAULT '[]',
  score_json    TEXT    NOT NULL DEFAULT '{}',
  event_ids_json TEXT   NOT NULL DEFAULT '[]',
  reviewed_at   INTEGER,
  UNIQUE(game_id, moment_key)
);
CREATE INDEX moments_game_score ON moments(game_id, score DESC);

CREATE TABLE notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  moment_id   INTEGER REFERENCES moments(id) ON DELETE SET NULL,
  video_t_ms  REAL,
  text        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER
);
CREATE INDEX notes_game ON notes(game_id);

CREATE TABLE tags (
  moment_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  tag       TEXT    NOT NULL,
  PRIMARY KEY (moment_id, tag)
);
CREATE INDEX tags_tag ON tags(tag);

CREATE TABLE clips (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  segment_id  INTEGER REFERENCES segments(id) ON DELETE SET NULL,
  t_in_ms     REAL    NOT NULL,
  t_out_ms    REAL    NOT NULL,
  path        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX clips_game ON clips(game_id);

CREATE TABLE timeline_cache (
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  source      TEXT    NOT NULL,
  fetched_at  INTEGER NOT NULL,
  json        TEXT    NOT NULL,
  PRIMARY KEY (game_id, source)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
