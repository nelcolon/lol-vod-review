# LoL VOD Review Tool — Implementation Plan

Status: v1 plan, 2026-10-29. Evidence base: `reports/LoL VOD review tool landscape.md`
(6,200 words, every claim labelled verified / community / inferred / unverified) and the
eight note files under `research_notes/`. Section 9 lists what still needs a hands-on spike.

## 1. Product in one paragraph

A Windows desktop app that sits in the tray, notices when a League of Legends game starts,
records the whole game with near-zero FPS cost, logs every kill / death / objective with a
precise video timestamp, and after the game opens a review screen that shows a short, ranked
list of the moments worth re-watching (your deaths first, then objective swings, then kills),
each one opening 30-60 s *before* the trigger so you review the decision, not the outcome.
Everything coaching-related happens after the game. Nothing touches the game process.

What it is **not**: not an in-game overlay, not a cloud service, not an Overwolf app, not a
clip-sharing social product. Those are deliberate exclusions (see §2 and §8).

## 2. Hard constraints (from the research)

### 2.1 Vanguard / Riot policy — the rules the design must never break

| Do | Don't |
|---|---|
| Capture video with Windows Graphics Capture (WGC) or DXGI Desktop Duplication from our own process | Inject a DLL / hook Present in `League of Legends.exe` (OBS's own signed hook lost League for 7 months, Dec 2024 → Jul 2025) |
| Read game state only from `https://127.0.0.1:2999` (Live Client Data) and the LCU | Open the game process with `PROCESS_VM_READ` or anything beyond `PROCESS_QUERY_LIMITED_INFORMATION`; never read memory |
| Detect the game via LCU gameflow phase and 2999 availability; window enumeration only as fallback | Send input to the game window (`SendInput`, `PostMessage`); Vanguard detects and names the sending process. Hotkeys via `RegisterHotKey` only |
| Register on the Riot Developer Portal before distributing to others (not needed for private/dev use) | Ship or depend on any kernel driver (incl. hardware-monitor libs like WinRing0/RTCore) |
| Show coaching / ranking **only after the game** | Show "conclusions during gameplay" (explicitly forbidden by Riot's third-party policy) |
| Test on bare-metal Windows with HVCI on | Stop/disable Vanguard (ReplayBook's `.rofl` workaround) or require test-signing |
| Treat the LCU as "may change without notice"; degrade gracefully | Embed a Riot API key in the client binary |

### 2.2 Data-source facts that shape the architecture

- **Live Client Data API** (`127.0.0.1:2999/liveclientdata/*`, self-signed cert, poll-only,
  10-33 ms round trip). 17 event types verified from 2026 captures:
  `GameStart, MinionsSpawning, FirstBlood, ChampionKill, Multikill, Ace, FirstBrick,
  TurretKilled, InhibKilled, InhibRespawningSoon, InhibRespawned, DragonKill, HordeKill
  (Voidgrubs), HeraldKill, BaronKill, AtakhanKill, GameEnd`. `Stolen` is the string
  `"True"/"False"`. `EventTime` is game seconds on the same clock as `/gamestats.gameTime`.
  Events are cumulative; dedupe on `EventID`. No positions, damage, wards, items, cooldowns.
- **Structure IDs changed format three times** (`Turret_T2_L_03_A` → `Turret_T100_L2_P3_…` →
  `Turret_TChaos_L2_P3_…`). Parser must accept all three and derive team from the ID.
- **Spectator / replay mode drops every epic-monster and inhibitor event.** The live event
  log must be persisted next to the recording; it can never be rebuilt from a replay.
- **LCU** (lockfile → port + Basic auth `riot:<token>`): gameflow phases (`ChampSelect,
  GameStart, InProgress, Reconnect, WaitingForStats, EndOfGame…`), `/lol-end-of-game/v1/eog-stats-block`,
  `/lol-match-history/v1/game-timelines/{gameId}` (timeline without an API key — to verify),
  `/lol-replays/v1/rofls/{gameId}/watch`.
- **match-v5 timeline** adds kill positions, per-ability damage, bounties, wards, items,
  1-minute participant frames. Needs a Riot API key; a public app needs a production key
  behind a small proxy. Not required for the MVP.
- **Replays** (`.rofl`) only play on the same patch, must be launched through the LCU, and the
  Replay API can seek/camera/fog/record. A short-lived enhancement, never the archive.
- **League requires DX11 and Windows 10 19041+** (since 25.02 / 25.21). WGC is available
  everywhere League runs.

### 2.3 Platform / business facts

- Overwolf: from **2026-11-01** only apps using Overwolf monetization (ads/subs) get approved.
  Its LoL events wrap the same 2999 API. → Standalone, no Overwolf.
- Code signing: EV certs no longer bypass SmartScreen; Azure Artifact Signing is not
  available to individuals in the Dominican Republic. Options are an OV cert from a
  commercial CA or the Microsoft Store. Not an MVP concern (personal use first).
- Market gap: Outplayed/Medal/Insights/Ascent all auto-clip kills and objectives; **none
  ranks mistakes or opens a window before the death**. That is the differentiator.

## 3. Architecture

```
┌─────────────────────────────── Windows host ───────────────────────────────┐
│                                                                            │
│  League Client (LCU)        League of Legends.exe (game)                   │
│  lockfile → :port           https://127.0.0.1:2999                         │
│        │                           │                                       │
│        ▼                           ▼                                       │
│  ┌──────────────────────────────────────────────┐    ┌──────────────────┐  │
│  │  core (Electron main process, TypeScript)    │    │ recorder sidecar │  │
│  │  • game-lifecycle state machine              │───▶│ (WGC → HW enc)   │  │
│  │  • LCU client  • LiveClient poller (2 Hz)    │◀───│ JSON-lines stdio │  │
│  │  • clock mapper (gameTime ⇄ QPC ⇄ video t)   │    └──────────────────┘  │
│  │  • event log writer  • post-game pipeline    │    ┌──────────────────┐  │
│  │  • moments engine  • SQLite (WAL)            │───▶│ ffmpeg (LGPL)    │  │
│  │  • retention / quota                         │    │ remux, cut, thumbs│ │
│  └──────────────────────────────────────────────┘    └──────────────────┘  │
│        │ IPC                                                               │
│        ▼                                                                   │
│  ┌──────────────────────────────────────────────┐                          │
│  │  review UI (Electron renderer, React + TS)   │                          │
│  │  game list · player · marker timeline ·      │                          │
│  │  ranked moments · notes/tags · clip export   │                          │
│  └──────────────────────────────────────────────┘                          │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Shell: Electron + TypeScript (decision)

Chosen over Tauri because the developer is strongest in JS/web, Chromium's codec behaviour
is known (H.264 hardware decode guaranteed), there is a maintained analogue to copy from
(`aza547/wow-recorder`: Electron app that auto-records WoW fights with a replay viewer), and
no Rust is required for the app itself. Cost: ~150 MB install, ~100 MB idle RAM. Acceptable
for a tool whose users run a 4 GB game. Tauri stays as a documented alternative if idle
footprint becomes a complaint.

### 3.2 Recorder sidecar: one contract, three candidate backends

The core never links capture code. It spawns a `recorder` process and speaks JSON lines:

```
→ {"cmd":"start","hwnd":123,"pid":456,"out":"…\\game.mp4","fps":60,"bitrateMbps":12,"audio":{"game":true,"mic":false}}
← {"ev":"started","qpcStart":…,"wallStart":"2026-…Z","encoder":"h264_nvenc"}
← {"ev":"stats","frames":3600,"dropped":2,"t":60.0}
← {"ev":"warning","code":"black_frames"}       // all-black or frozen frames detected
→ {"cmd":"stop"}
← {"ev":"stopped","durationMs":…,"path":"…"}
```

Candidates, ranked by expected fidelity (Phase 0 decides):

| Backend | How | Pros | Cons |
|---|---|---|---|
| **A. Rust `windows-capture` crate (2.0.1, MIT)** as a ~300-line CLI | WGC by HWND → Media Foundation H.264/HEVC; built-in audio with monotonic timing | Video+audio+QPC in one process, frame-accurate `SystemRelativeTime`, no FFmpeg at capture time | Some Rust (thin wrapper; the crate does the work) |
| **B. FFmpeg 8.1 CLI** `-f lavfi -i gfxcapture=window_exe=…` (or `ddagrab`) `-c:v h264_nvenc` | Days to wire | No native WASAPI loopback input on Windows FFmpeg → audio needs a second path; per-frame QPC not exposed (tens-of-ms alignment; fine for review) ; `gfxcapture` is brand new |
| **C. User's OBS via obs-websocket v5** | `StartRecord`/`StopRecord`, `CreateRecordChapter` | Zero capture code, power users already have OBS tuned | Dependency on user's OBS; Safe Mode disables websocket (OBS 33); ms-level duration only |

Default plan: **A for v1**, B as the fallback backend, C as an opt-in "bring your own OBS"
mode later. Alignment target: event marker within ±250 ms of the on-screen moment (coaches
rewind 30-60 s anyway, so even B's precision is sufficient; A simply removes the question).

Encoder ladder inside the sidecar: NVENC → AMF → QSV → software x264 (warn user).
Format: **H.264**, 1-second GOP (precise seeks and `-c copy` cuts), CFR 60 (or 30 preset),
default 12 Mbps at 1080p (~2.7 GB / 30 min). Written as **fragmented MP4** so a crash loses
≤1 s; remuxed to faststart MP4 post-game.

Audio: system loopback (everything the user hears, by choice 2026-10-29), optional mic on a second track.

### 3.3 Game lifecycle state machine (core)

```
IDLE ──lockfile appears──▶ CLIENT_UP ──gameflow=ChampSelect──▶ CHAMP_SELECT
  ▲                                                              │ gameflow=InProgress
  │                                                              ▼
  │                                                     LOADING (2999 not 200 yet)
  │                                                              │ first 200 on /gamestats
  │                                                              │ + game HWND found
  │                                                              ▼
  │        ┌──── gameflow=Reconnect / HWND lost ─────  RECORDING  (poll 2 Hz)
  │        ▼                                                     │ GameEnd event
  │   RECONNECTING ── new HWND ──▶ RECORDING (new segment)       │ or 2999 gone
  │                                                              ▼
  │                                                      POST_PROCESS
  │   remux · thumbnails · LCU eog-stats · (timeline fetch) · moments · retention
  └──────────────────────────────────────────────────────────────┘
```

Rules:
- `gameflow-phase` is the primary signal; 2999 is the confirmation and the event source;
  process/window enumeration (`League of Legends.exe`) is the fallback if the LCU is closed.
- Record only queues the user enabled (default: Summoner's Rift ranked/normal/flex, ARAM;
  off: Practice Tool, custom, Arena/Brawl, spectate, replay). Gate by `queueId`/`gameMode`
  from `/gamestats` and the LCU session. Riot forbids aggregating Brawl data — never store it.
- Remake (game < 4 min with `Neither`) → delete recording unless the user pinned it.
- Each recording **segment** is its own file; a game may have several (reconnects).

### 3.4 Clock mapping (the part that makes markers land)

Three clocks: `gameTime` (seconds, from 2999), QPC (host), video PTS (sidecar).
1. Every `/gamestats` poll is stamped with QPC at request start and end; use the midpoint.
2. Maintain a piecewise-linear fit `QPC = a + b·gameTime` per segment (`b ≈ 1`). Open a new
   piece whenever `gameTime` stops advancing (loading, pause, reconnect).
3. Sidecar reports `qpcStart` of frame 0; video time of an event = `QPC(EventTime) − qpcStart`.
4. `GameStart` event ≙ game t=0, not the first HTTP 200.
5. Post-game sanity check against match-v5 `gameStartTimestamp` when available.

### 3.5 Data model (SQLite, WAL, single writer in core)

```
games(id, game_id, platform, queue_id, game_mode, patch, started_at, ended_at, result,
      my_puuid, my_champion, my_role, duration_s, status)
segments(id, game_id, path, qpc_start, wall_start, duration_ms, width, height, fps, codec, size_bytes)
participants(game_id, slot, riot_id_name, puuid, team, champion, role)
events(id, game_id, event_id, name, game_time_s, video_segment_id, video_t_ms, payload_json)
moments(id, game_id, kind, score, t_start_ms, t_trigger_ms, t_end_ms, segment_id,
        title, reason_json, theme, reviewed_at)
notes(id, game_id, moment_id?, video_t_ms, text, created_at)
tags(moment_id, tag)           -- cause taxonomy: positioning, decision, skill, vision, cooldowns, map-awareness, sacrifice, meaningless
clips(id, game_id, segment_id, t_in_ms, t_out_ms, path, created_at, pinned)
timeline_cache(game_id, source, fetched_at, json)   -- LCU or match-v5 timeline
settings(key, value)
```
Files: `%LOCALAPPDATA%\<app>\recordings\YYYY-MM\<gameId>\segment-01.mp4`, `events.jsonl`
(raw 2999 dumps for re-processing), `thumbs/`, `clips/`.

### 3.6 Moments engine

**v1 (rule-based, live data only)** — ships in Phase 2.
- Triggers: own death (weight 1.0), own kill 0.6, own assist 0.4, team/enemy epic monster
  (with `Stolen`), tower/inhib, ace, multikill, FirstBlood/FirstBrick folded into their twins.
- Cluster events within 15 s into one moment; window = 45 s pre-roll (configurable 30-90)
  to 10 s after the last event in the cluster.
- `score = w1·self_involvement + w2·stakes + w3·participants + w4·phase + w5·death_cost`
  where stakes rank Elder/Baron > soul-point drake > first tower > other drakes/Herald/grubs,
  phase boosts pre-14:00 deaths for laners, `death_cost` = respawn timer from `/playerlist`
  plus whether an enemy objective fell within ±60 s ("death traded into objective").
- Labels detectable live: solo death (no assisters) vs gank/collapse (≥2 killers), teamfight
  (≥3 kills in 15 s), sacrifice (team kill/objective within the respawn window) vs
  meaningless (nothing followed).
- Output: a shortlist of 5-10 moments grouped by theme, plus the full timeline.

**v2 (post-game enrichment)** — Phase 3. Pull the timeline (LCU `game-timelines` first,
match-v5 via proxy later) and add: kill position (under own tower vs overextended), killer
roles (jungler gank), `victimDamageReceived` (1v1 loss vs collapse), ult unused at death,
`shutdownBounty`, gold swing over ±90 s, win-probability swing from a simple logistic prior
(gold diff, drakes, phase; Oracle's Elixir EGR-style). Recurrence: boost death types seen in
the player's last N games. Label swings "what happened", never "your fault".

**v3 (optional, computer vision on the recording)** — later. Minimap tracking for
"isolated at death" and vision state; Flash-cooldown reading from the HUD. Only if v2 proves
insufficient.

### 3.7 Review UI (renderer)

- **Library**: games by date with champion, result, KDA, duration, storage, review status.
- **Game view**: `<video>` (H.264 → hardware decode, Range-served via custom protocol) with a
  marker timeline colour-coded by type and a lane of *my* events vs team events; right rail =
  ranked moments with theme filters (deaths / objectives / kills / all, mine / team);
  keyboard: J/K/L, `,` `.` frame step, `[` `]` prev/next moment, 1-4 speed presets, B bookmark.
- **Moment card**: title ("Solo death mid, 11:42, Flash likely down"), why it ranked,
  prompt "What did I know? What should I have done?", tags (cause taxonomy), free-text note,
  "jump 60 s earlier", export clip.
- **Trends** (Phase 3): recurring tags across games, deaths-before-14 trend, objective
  participation, sacrifice vs meaningless ratio.
- Player library: Video.js 10 (Vidstack and Plyr are deprecated) or a bare `<video>` with a
  custom timeline. Decide in Phase 1 by prototyping the marker timeline on bare `<video>` first.

### 3.8 Clip and export pipeline

`ffmpeg -ss <t_in> -to <t_out> -i segment.mp4 -c copy` (1 s GOP ⇒ ≤1 s slop) for fast cuts;
re-encode only for frame-exact or when stitching a highlight reel (`concat` demuxer).
Thumbnail sprite sheet per game for hover-scrub. Bundle BtbN `win64-lgpl` FFmpeg as a signed
sidecar; never libobs/obs-studio-node (GPL).

### 3.9 Retention

Quota in GB (default 50), oldest unpinned games deleted first, clips and pinned games exempt,
"low disk" warning before a game starts. Bitrate presets: 1080p60 12 Mbps (default), 1080p30
8 Mbps (laptops), 1440p60 20 Mbps.

## 4. Development environment

- Source lives in a git repo; edit from WSL; **build and run on the Windows host** (WGC, 2999
  and the LCU are not reachable from WSL — only via `curl.exe`). Run `npm`/`electron` through
  `cmd.exe /c` or PowerShell from WSL, or keep a Windows terminal open. CI: GitHub Actions
  `windows-latest`.
- Monorepo layout:
  ```
  lol-vod-review/
    apps/desktop/        Electron + React + TS (main, preload, renderer)
    packages/core/       lifecycle, LCU client, live-client poller, clock mapper, moments
    packages/recorder/   Rust CLI (windows-capture) — sidecar
    packages/schema/     zod types for 2999/LCU payloads + fixtures from real captures
    tools/               spike scripts, event-dump recorder, PresentMon harness
    docs/                PLAN.md (this), ADRs, research
  ```
- Fixtures: record raw `eventdata`/`playerlist`/`gamestats` dumps from real games (Phase 0)
  and test the parser/moments engine offline against them. The whole core must be testable
  without League running.
- Bare-metal test rig with HVCI on; one NVIDIA machine, borrow an AMD/Intel one for the
  encoder ladder.

## 5. Phases and milestones

Estimates assume a solo developer working with AI assistance, part-time.

### Phase 0 — Spikes and decisions (1-2 weeks)
Goal: answer the 15 open questions in §9 that change the design, produce ADR-001 (shell),
ADR-002 (recorder backend), ADR-003 (timeline source).
1. `tools/event-dump`: Node script on Windows polling 2999 at 4 Hz through load screen → end,
   for 5+ games incl. one Practice Tool, one ARAM, one spectate. Saves raw JSON fixtures.
2. Recorder bake-off: minimal A (Rust crate) and B (FFmpeg gfxcapture/ddagrab) recording a real
   game; measure FPS cost with PresentMon + `nvidia-smi dmon`; test Fullscreen vs Borderless,
   alt-tab, HDR; black-frame detection.
3. Alignment test: flash a known `gameTime` on screen (e.g. death timer), measure offset.
4. LCU `game-timelines` vs match-v5 for the same game (does it contain positions/damage?).
5. Process-loopback audio on Windows 10 19045.
6. Riot Developer Portal: no registration needed for personal/dev use (2999 and LCU need no key).
   Grab a development key only if a spike calls match-v5; register for a personal key when
   Phase 3 needs stable Web API access; full registration + audit only before sharing the app.
Exit: measured overhead table, chosen backend, fixture set committed.

### Phase 1 — Record every game (2-3 weeks)
- Electron skeleton, tray app, autostart option, settings.
- LCU client (lockfile watch, gameflow phase, session, current summoner).
- Live Client poller + schema (all 17 events, 3 structure-ID formats), `events.jsonl`.
- Lifecycle state machine incl. reconnect segments and queue gating.
- Recorder sidecar integration + encoder ladder + fMP4 + post-game remux.
- Clock mapper; events get `video_t_ms`.
- Minimal game view: video + marker timeline + click-to-seek.
Exit: 10 consecutive games recorded unattended with markers landing within ±250 ms.

### Phase 2 — Review, not just replay (2-3 weeks)
- Moments engine v1, ranked shortlist with themes, moment cards, cause tags, notes.
- Keyboard-driven review flow, pre-roll jump, speed presets.
- Clip export (`-c copy`), thumbnails, pin/delete, retention quota.
- Library view with filters; remake auto-delete.
Exit: a full post-game review of a real game takes <10 minutes using only the shortlist.

### Phase 3 — Post-game intelligence (2-3 weeks)
- Timeline ingestion (LCU first; match-v5 proxy if needed) → death taxonomy v2, gold/WP
  swing, ult-unused, under-tower vs overextended, jungler-gank detection.
- Trends view across games; recurrence boosting in the ranker.
- LCU end-of-game stats block stored per game (KDA, CS, vision, damage).
Exit: each own-death card shows a data-backed reason, and the trends view shows top 3
recurring causes over the last 20 games.

### Phase 4 — Ship-able (2 weeks)
- Installer (NSIS via electron-builder), auto-update (GitHub Releases), crash reporting
  opt-in, first-run wizard (quota, bitrate, queues, Borderless recommendation).
- Code signing path: OV cert or Store; sign `ffmpeg.exe` and the recorder too.
- Compliance doc (§2.1 as a checklist), Riot Developer Portal registration (required before
  distributing to anyone else), privacy note (all local).
Exit: clean install on a fresh Windows 11 machine records the first game with no setup.

### Phase 5 — Later / optional
- "Re-watch with team fog": launch same-patch replay via LCU, drive Replay API to seek to the
  moment and re-record (patch-limited).
- Highlight reel stitching, share to Medal/YouTube.
- CV minimap tracking for isolation/vision; Flash-cooldown OCR.
- OBS-websocket backend; Tauri port if footprint matters; multi-track audio editor.

## 6. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| WGC capture of League Fullscreen mode is black/frozen | No recording | Detect black frames in the sidecar within 3 s, fall back to monitor capture, recommend Borderless in the wizard |
| Riot changes 2999 payloads / structure IDs again | Markers mis-attributed | Schema with permissive parsing + unknown-event passthrough; raw `events.jsonl` kept so games can be re-processed; fixtures from each patch |
| LCU endpoints vanish (unsupported by Riot) | Lose lifecycle/timeline | Process/window detection fallback; 2999 remains the event source; timeline becomes optional |
| FPS cost too high on low-end PCs | Users uninstall | Encoder ladder, 1080p30 preset, measured overhead published in settings, pause recording below an FPS floor |
| Vanguard update breaks something indirectly | Game won't start, blame lands on us | Nothing in-process, no drivers; a "compatibility" page explaining exactly what the app touches |
| Disk fills | Lost games / angry users | Quota + pre-game free-space check |
| Production API key not granted | No match-v5 | LCU `game-timelines` path; v1 ranking needs no key at all |
| SmartScreen warning scares users | Adoption | OV cert early; Store later; personal use first anyway |
| Atakhan removed in 26.01 but events linger in data | Parser confusion | Accept legacy names; gate objective list by patch |

## 7. Compliance checklist (ship gate)

- [ ] No module opens the game process beyond `PROCESS_QUERY_LIMITED_INFORMATION`.
- [ ] No DLL injection, no hooks, no drivers, no input to the game window.
- [ ] All game data from 2999, LCU, or Riot Web API; raw dumps stored locally only.
- [ ] No in-game overlay with session information; no coaching text until `GameEnd`.
- [ ] Brawl data never stored or aggregated; queue gating tested.
- [ ] Riot Developer Portal product registered before public release; API key never in the client.
- [ ] LGPL FFmpeg build with licence notice; no GPL libraries linked.
- [ ] Tested on bare metal with HVCI, Secure Boot, TPM on.

## 8. Decisions made (and why)

1. **Standalone, not Overwolf**: Overwolf's 2026-11-01 monetization mandate, its events are a
   wrapper around 2999, and users actively flee it.
2. **Electron, not Tauri/.NET**: developer skill fit, known codecs, wow-recorder as analogue.
3. **Record full games, not a ring buffer**: review needs the 60 s before deaths; clips are
   cut from the full file; storage handled by quota.
4. **Post-game only**: Riot policy, and coaches say review is a separate activity.
5. **Rank moments, don't list events**: the market already lists events; nobody ranks.
6. **Persist live events**: replay/spectate feeds drop objectives, so the live log is canonical.
7. **H.264 + 1 s GOP + fMP4**: guaranteed playback, precise seeks, crash safety.

## 9. Open questions for Phase 0 (from the report, ordered by design impact)

1. Real FPS/CPU/GPU cost of WGC→NVENC vs DDA vs OBS Window Capture in League.
2. WGC behaviour on Fullscreen (not Borderless), alt-tab, minimize, resolution change.
3. Full 26.x `eventdata` dump: do `AtakhanKill`/feats appear; current inhibitor ID format;
   L0/L1/L2 → top/mid/bot mapping; nexus-turret IDs.
4. 2999 status during loading screen; `gameTime` on pause/reconnect/chronobreak.
5. Does a reconnect create a new HWND/process and does `EventID` continue?
6. Non-champion `KillerName` strings (turret, minion, Baron) on `ChampionKill`.
7. Does LCU `game-timelines` return match-v5-equivalent data (positions, damage arrays)?
8. Process-loopback audio on Windows 10 19045.
9. Event-to-video alignment precision per backend.
10. Yellow WGC border on Windows 10; suppression on Windows 11 without package identity.
11. Seek latency on a 45-min 1080p60 file in Chromium; HEVC without the Store extension.
12. Replay API `/replay/recording` and LCU `/watch` on 26.x; what `/replay/events` returns.
13. Streamer Mode effect on 2999 output.
14. Live Client behaviour in ARAM, Arena, Brawl, Practice Tool.
15. Riot Developer Portal turnaround for a local-only recorder.

## 10. Next concrete steps

1. Confirm the Windows test rig (GPU vendor, Windows build, League display mode).
2. Create the monorepo skeleton and `tools/event-dump`; record 5 games of fixtures.
3. Try the LCU `game-timelines` endpoint before touching the Riot Web API at all.
4. Run the recorder bake-off (A vs B) and write ADR-002 with the measured overhead table.
5. Start Phase 1.
