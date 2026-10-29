# @lvr/core

Pure, testable core of lol-vod-review (see `docs/PLAN.md` §3). Nothing in this package
touches League, Electron, Windows APIs or the network directly: clocks, `fetch`, timers and
the filesystem are injected, so every module runs under vitest on any OS. The only native
dependency is `better-sqlite3` (prebuilt binaries; loads on Windows Node 24).

```
src/
  types.ts        Live Client event/gamestats/playerlist types (TODO: switch to @lvr/schema)
  lifecycle/      state machine (pure reducer) + queue/remake policy + LifecycleRunner
  livepoller/     LiveClientPoller: /gamestats + /eventdata at 2 Hz, /playerlist at 1 Hz
  clock/          ClockMapper: piecewise-linear gameTime → host ns → video ms
  events/         normalizeEvents: raw events → EventRow (FirstBlood/FirstBrick folded)
  moments/        moments engine v1: cluster → score → label → shortlist
  db/             SQLite (WAL) schema, versioned migrations, GameStore repository
  retention/      planRetention + pre-game free-space check
  testing/        FakeScheduler / FakeClock for deterministic tests
```

## Modules

### `lifecycle/` — PLAN §3.3

`reduce(ctx, input, options) → { ctx, effects }` is a pure reducer over the states
`IDLE, CLIENT_UP, CHAMP_SELECT, LOADING, RECORDING, RECONNECTING, POST_PROCESS`.

Inputs: `lockfileAppeared/Vanished`, `gameflowPhase`, `liveClientUp{info}`,
`liveClientLost`, `gameWindowFound{hwnd,pid}/Lost`, `queueInfo`, `gameEnd{result,gameTimeS}`,
`postProcessDone`, `reconnectTimeout`, `userPause{paused}`, `pinGame`.

Effects (the host performs them): `startPolling`, `stopPolling`,
`startRecording{segmentIndex,hwnd,pid}`, `stopRecording`, `runPostProcess{game}`,
`discardGame{reason,game}`, `skipGame{reason,info}` (game watched for its end but not
recorded: queue disabled or user paused).

Rules implemented: LCU phase is primary, 2999 confirms, window is required to start a
segment (`requireGameWindow`, default true); each reconnect / un-pause opens a new segment;
`gameEnd`, 2999 loss or `WaitingForStats` end the game; remakes (< 4:00 and `Neither`) are
discarded unless pinned; a `gameWindowFound` carrying the PID of the game that just finished
is ignored (end-of-game screen). `shouldRecord(queueId, gameMode, mapId, settings)` with
`DEFAULT_RECORDING_SETTINGS` (SR normal/ranked/flex/swiftplay/quickplay/clash + ARAM on;
Practice Tool, custom, Arena, spectate/replay, other modes off; Brawl always off).

`LifecycleRunner` wraps the reducer with an injected `Scheduler`: it dedupes gameflow
phases, turns `liveOk()/liveFailed()` into a debounced `liveClientLost` (default 8 s) and
times out `RECONNECTING` (default 5 min).

### `livepoller/`

`new LiveClientPoller({ fetch, clock, scheduler, hz: 2, playerlistHz: 1, ... })` with
callbacks `onFirstResponse`, `onGameStats(sample)`, `onEvent(timed)`, `onPlayerList`,
`onActivePlayer(name|null, spectator)`, `onLost`, `onError`. Every request is stamped with
`clock.hrtimeNs()` before/after; `sample.hostNsMid` is what the clock mapper consumes.
Events are deduped by `EventID` and coerced (`Stolen: "True"` → `true`). 404/ECONNREFUSED
before the first 200 are silent (loading screen). Inject a `fetch` that trusts Riot's
self-signed certificate (undici `Agent({ connect: { rejectUnauthorized: false } })` or
`riotgames.pem`).

### `clock/` — PLAN §3.4

`ClockMapper.addSample(gameTimeS, hostNs)` keeps a least-squares fit `hostNs = a + b·gameTime`
per piece. A new piece opens when gameTime stops advancing (loading screen, pause,
chronobreak) or jumps relative to the host clock (reconnect fast-forward); a plain sample
gap with aligned clocks stays on the same line. The slope is pinned to 1 until 10 points
exist, then fitted and clamped to [0.98, 1.02]. `toHostNs(gt)`, `toVideoMs(gt, segmentStartNs)`,
`toGameTime(hostNs)`, `locate(gt)` (piece, extrapolation, residual RMS, confidence 0..1),
`stats()`.

### `events/`

`normalizeEvents(rawEvents, { gameId, clock, segments })` → `EventRow[]` with
`video_segment_id`/`video_t_ms` (null when unplaceable). `FirstBlood` → `payload.firstBlood`
on its `ChampionKill` twin, `FirstBrick` → `payload.firstBrick` on its `TurretKilled`.
`structureTeam(id)` derives the owning team from any of the three structure-ID formats.

### `moments/` — PLAN §3.6

`computeMoments({ events, me, participants, playerSnapshots, config })` → `Moment[]` sorted
by score. Triggers: own death (1.0), own kill (0.6), own assist (0.4), epic monsters (stolen
bonus), towers/inhibs, ace, multikill; other kills join clusters as context. Events within
15 s cluster; window = trigger − preRoll (45 s, clamped 30–90) to last event + 10 s.

`score = 0.40·self_involvement + 0.25·stakes + 0.10·participants + 0.10·phase + 0.15·death_cost`

Stakes: Elder/Baron 1.0 > soul drake / drake at soul point 0.85 > first tower / inhibitor
0.6 > drake / Herald / Atakhan 0.5 > grubs 0.4 > tower 0.4; `+0.25` when stolen. Phase: own
death before 14:00 → 1.0 (laner). Death cost: respawn timer (from `/playerlist` snapshot,
else estimated) / 60 s, +0.5 if an enemy objective fell within ±60 s. Labels: `solo`,
`gank`, `teamfight` (≥3 kills in 15 s), `sacrifice` vs `meaningless`, `traded_into_objective`,
`executed`, `early`, `stolen`, `first_blood`, `first_tower`, `soul_point`, `multikill`, `ace`.
Output has `title` ("Solo death, 11:42"), `theme` (deaths / objectives / kills / team),
`reasons[]`, `components`, game-time and video-time windows, `eventIds`.
`shortlist(moments, { max: 8, perTheme })` applies per-theme caps; `groupByTheme` groups.
All weights live in `DEFAULT_MOMENTS_CONFIG` (`moments/config.ts`).

### `db/` — PLAN §3.5

`openDatabase(path)` (WAL, foreign keys, migrations via `PRAGMA user_version`) and
`new GameStore(db)`: `insertGame/updateGame/setGamePinned/getGame/getGameByGameId/listGames/
deleteGame`, `addSegment/updateSegment/listSegments`, `upsertParticipants`,
`bulkInsertEvents/listEvents`, `replaceMoments/listMoments/markMomentReviewed`, notes CRUD,
tags (`setTags/addTag/removeTag/getTags/listTagCounts`), clips CRUD, `putTimeline/getTimeline`,
settings (`getSetting/setSetting/getSettingJson/setSettingJson/getAllSettings`),
`retentionCandidates()`. Migrations are TS modules exporting SQL (`db/migrations/001_init.ts`)
so they ship inside the bundle. Schema deviations from the plan are additive and listed at
the top of that file (`games.pinned`, `segments.seq`, game-time columns on `moments`).

### `retention/` — PLAN §3.9

`planRetention(games, quotaBytes, { headroomBytes, minAgeMs })` → deletions oldest-unpinned
first; pinned and in-flight games exempt; clips are separate files and never counted.
`checkFreeSpace({ statfs, path, requiredBytes })` with `statfsAdapter(fs.statfs)`,
`estimateGameBytes(bitrateMbps, durationS)`.

## How the desktop app wires it (Electron main process)

```ts
import {
  ClockMapper, GameStore, LifecycleRunner, LiveClientPoller, computeMoments, normalizeEvents,
  openDatabase, planRetention, realHostClock, realScheduler, shortlist,
} from '@lvr/core';

const store = new GameStore(openDatabase(path.join(app.getPath('userData'), 'lvr.sqlite')));
let mapper = new ClockMapper();
const rawEvents: LiveEvent[] = [];          // also appended to events.jsonl on disk
const snapshots: PlayerSnapshot[] = [];

const poller = new LiveClientPoller({
  fetch: insecureLocalFetch,                 // undici Agent that trusts 127.0.0.1:2999
  clock: realHostClock, scheduler: realScheduler,
  onFirstResponse: (s) => runner.liveOk({ gameMode: s.stats.gameMode, mapId: s.stats.mapNumber }),
  onGameStats: (s) => { runner.liveOk(); mapper.addSample(s.gameTime, s.hostNsMid); },
  onEvent: ({ event }) => { rawEvents.push(event); if (event.EventName === 'GameEnd') runner.dispatch({ type: 'gameEnd', result: event.Result, gameTimeS: event.EventTime }); },
  onPlayerList: (p) => snapshots.push({ gameTime: p.gameTime, players: p.players }),
  onActivePlayer: (name, spectator) => runner.dispatch({ type: 'queueInfo', info: { spectator } }),
  onLost: () => runner.liveFailed(),
});

const runner = new LifecycleRunner({
  onEffect: async (effect) => {
    switch (effect.type) {
      case 'startPolling':   poller.resetEvents(); mapper = new ClockMapper(); poller.start(); break;
      case 'stopPolling':    poller.stop(); break;
      case 'startRecording': recorder.start({ hwnd: effect.hwnd, out: segmentPath(effect.segmentIndex) }); break; // sidecar returns qpcStart
      case 'stopRecording':  recorder.stop(); break;
      case 'runPostProcess': {
        const rows = normalizeEvents(rawEvents, { gameId, clock: mapper, segments });
        store.bulkInsertEvents(game.id, rows);
        const moments = computeMoments({ events: rows, me, participants, playerSnapshots: snapshots });
        store.replaceMoments(game.id, moments);
        // remux, thumbnails, LCU eog-stats, then:
        for (const d of planRetention(store.retentionCandidates(), quotaBytes).deletions) deleteGameFiles(d.gameId);
        runner.dispatch({ type: 'postProcessDone' });
        break;
      }
      case 'discardGame':    deleteGameFiles(...); break;
      case 'skipGame':       log(effect.reason); break;
    }
  },
});

// Adapters feed the runner:
lockfileWatcher.on('appear', () => runner.dispatch({ type: 'lockfileAppeared' }));
lcu.on('gameflow-phase', (phase) => runner.dispatch({ type: 'gameflowPhase', phase }));
lcu.on('session', (s) => runner.dispatch({ type: 'queueInfo', info: { queueId: s.gameData.queue.id } }));
windowWatcher.on('found', ({ hwnd, pid }) => runner.dispatch({ type: 'gameWindowFound', hwnd, pid }));
tray.on('pause', (paused) => runner.dispatch({ type: 'userPause', paused }));
```

The renderer reads `store.listGames()`, `store.getGame(id)` and shows
`shortlist(moments, { max: 8 })` grouped by theme; `moment.tStartMs` on `moment.segmentId`
is where the player seeks.

## Scripts (run on the Windows host)

```
npm run build -w packages/core
npm run test  -w packages/core
```
