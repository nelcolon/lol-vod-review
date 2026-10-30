# Handoff — state of the project on 2026-10-29

Purpose: let anyone (a person, or a cheaper model session) pick this up without re-reading the
research. Read this, then `docs/PLAN.md` for the architecture. Do not re-plan.

## Where things are

- Repo: https://github.com/nelcolon/lol-vod-review (public, MIT since 2026-10-30). Branch `main`, direct commits.
- Working copy: `C:\Users\ncolo\dev\lol-vod-review` (= `/mnt/c/Users/ncolo/dev/lol-vod-review` from WSL;
  `~/lol-vod-review` symlinks to it). Edit from WSL, **run everything on Windows**:
  `cmd.exe /c "cd /d C:\Users\ncolo\dev\lol-vod-review && npm <args>"` (cmd refuses a UNC cwd, so
  always `cd /d` inside the command). Port 2999 and the LCU are unreachable from WSL.
- Host: Windows 11 25H2 (26200), RTX 4080 (driver 617.42), Node 24.3 / npm 11.4 (nvm4w),
  Rust stable MSVC (`C:\Users\ncolo\.cargo\bin`), VS 2022 Build Tools 14.44, League at
  `C:\Riot Games\League of Legends`. FFmpeg master 2026-10-28 (gfxcapture, ddagrab, NVENC) at
  `tools/bin/ffmpeg.exe` + `ffprobe.exe` (git-ignored; re-download from BtbN if missing).
- Insights Capture is installed on this PC and auto-records League. Close it before measuring
  our recorder's FPS cost.

## What exists and how far it is verified

| Piece | State | Verified |
|---|---|---|
| `docs/PLAN.md`, `docs/research/` | complete | evidence report with per-claim labels |
| `packages/schema` (`@lvr/schema`) | complete | 65 tests; parsed a live ranked game's 2999 payloads |
| `tools/event-dump` | complete | 11 tests; ran against a live game (LCU + 2999, 4 Hz/1 Hz), writes `fixtures/raw/<ts>/` |
| `packages/core` (`@lvr/core`) | complete, **not wired to the app** | 92 tests, build + typecheck clean on Windows |
| `apps/desktop` (`@lvr/desktop`) | shell complete on **MockBackend** | typecheck, 23 tests, prod build, 15/15 smoke checks (`npm run smoke`); screenshots in `apps/desktop/dev-assets/shot-*.png` |
| `packages/recorder` (Rust `lvr-recorder`) | builds, works, README done | 27 unit tests; `--self-test`-style run produced 26 s 1282x752 60 fps H.264 + AAC via Media Foundation (NVIDIA MFT), JSON events `ready/started/stats` as per contract |
| `tools/bakeoff` | scripts exist, **plumbing only** | PresentMon installer, `Run-Bakeoff.ps1` (none/recorder/gfxcapture/ddagrab), `Start-TestWindow.ps1`, `Summarize-Results.ps1`; ran against a test window, never against League; **no README yet** |
| `fixtures/raw/` (git-ignored) | 3 short dumps of one live game (mid-game only) | — |

Commits: plan/research → skeleton → schema+event-dump → desktop → core → recorder+bakeoff+this file.

## What is NOT done (in order to do it)

Phase 0 — needs the human to play:
1. `tools/event-dump/Watch-Games.ps1` (hidden, loops one dump per game; log `%TEMP%\lvr-watch.log`) or run `npm run event-dump -- --max-seconds 3600` (from Windows) **before** queueing, through loading
   screen, a full game and the end screen. Do 5+ games incl. one Practice Tool, one ARAM, ideally
   one disconnect/reconnect. Answers PLAN §9 Q3-6, Q13-14. Then feed `fixtures/raw/*/eventdata.jsonl`
   through `@lvr/core` `normalizeEvents` + `computeMoments` and sanity-check the shortlist.
2. Bake-off in a Practice Tool game, Insights Capture closed: `tools/bakeoff/Run-Bakeoff.ps1 -Backend none`,
   then `recorder`, `gfxcapture`, `ddagrab` (120 s each), Borderless and Fullscreen. Fill the table in
   `docs/adr/ADR-002-recorder-backend.md`. Answers Q1, Q2, Q9, Q10.
3. Recorder gaps: README written, keyframes (1 s), CFR, encoder GPU (4080) checked; fragmented MP4 is
   impossible via the crate, so plain MP4 is **accepted for v1** (ADR-002). System loopback audio (everything,
   Discord included) is what the user wants, so per-process loopback is dropped. Still open: black/frozen-frame warnings in `detect.rs` untested
   against a real black capture.

Phase 1 — wiring: **done 2026-10-29, untested against a live game.**
4. `apps/desktop/src/main/core-backend.ts` (`CoreBackend`) is the default backend; `LVR_MOCK=1` or
   `LVR_SMOKE=1` brings back `MockBackend`. Pieces in `src/main/core/`: `http.ts` (2999 with Riot CA,
   LCU), `lcu.ts` (lockfile + gameflow 1 Hz + session), `recorder.ts` (sidecar JSON lines), `mapping.ts`
   (core rows → renderer contracts). Core switched to `node:sqlite` (better-sqlite3 cannot load in
   Electron 45). The recorder finds the League window itself (`requireGameWindow: false`).
   Data: `%APPDATA%\@lvr\desktop\lvr.sqlite`, videos + raw `events.jsonl` in `...\recordings\<ts>_<gameId>\`.
   Run with `npm run dev` from the repo root (builds schema + core first).
5. Not done: `@lvr/core/src/types.ts` → `@lvr/schema` imports.
6. Not done: faststart remux, thumbnails, retention run after each game. Phase 1 exit: 10 unattended
   games, markers within ±250 ms.

Phase 2-4: as in `docs/PLAN.md` §5 (review polish, LCU `game-timelines` enrichment → taxonomy v2,
trends, installer/signing). Riot Developer Portal registration only before sharing the app.

## Gotchas learned today

- Spawning subagents with `model: "opus"` was **not honoured** for three of five agents (they ran on
  Fable and burned the 5-hour limit). Verify with `grep -o '"model":"[^"]*"' <task>.output | sort | uniq -c`
  before letting a long build agent run, or do the work in a session already set to Opus.
- Several terminals sharing the root lockfile: wrap npm in `flock /tmp/lvr-npm.lock cmd.exe /c "..."`.
- Root `npm run event-dump` passes flags only because the script ends in `--`.
- `MinionsSpawning` fired at ~30 s game time in the live game, not ~65 s as older notes say.
- Electron dev builds skip autostart registration on purpose (`app.isPackaged` guard).
- `LVR_SMOKE=1` runs the desktop end-to-end self-test; `LVR_DEV_OPEN_FIRST=1` + `dev-assets/shot.ps1`
  takes a window-only screenshot with PrintWindow.
