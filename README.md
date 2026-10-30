# LoL VOD Review

Windows app that records every League of Legends game automatically and, once the game is over,
lines up the moments worth reviewing: your deaths, kills, assists, objectives, towers and
teamfights. Each moment opens a few seconds before it happens, so you watch the decision and
not only the outcome.

## Download

Get the latest installer from **[Releases](https://github.com/nelcolon/lol-vod-review/releases/latest)**:
`LoL VOD Review-Setup-<version>.exe`.

- It installs for your Windows user only, so no admin rights are needed.
- The installer is not code-signed yet. If Windows SmartScreen warns, click **More info** →
  **Run anyway**.
- The repository is private: you need access to it to download.

**Requirements:** Windows 10 (version 1903 or later) or Windows 11, 64-bit, and a GPU with a
hardware H.264 encoder (any recent NVIDIA, AMD or Intel). Windows "N" editions need the Media
Feature Pack.

## What it does

- **Records on its own.** Leave the app running (it can start with Windows and sit in the tray).
  It starts recording when a game loads and stops when it ends, for the queues you pick in
  Settings. Video is 1080p60 H.264 by default, with the sound you hear plus your microphone
  (microphone and its volume are set in Settings).
- **Library.** Every game with your champion and role, the player you were with (your support,
  ADC, jungler or mid depending on your role) and the enemies you played against. Results are
  coloured green for wins and red for losses.
- **Moments.** Deaths, kills, assists, objectives, towers and aces in the order they happened,
  filterable, each jumping to a few seconds before it (5–90 s, default 10).
- **Game state per moment.** Everyone's items, summoner spells, level and K/D/A around the play;
  who killed whom; what was used (potions, Stopwatch…) and what was bought after the fight; your
  gold in items compared with your lane opponent.
- **Player.** Timeline with event markers, keyboard controls (Space, ←/→ ±5 s, J/L ±10 s,
  `,`/`.` frame, M mute, 1–4 speed, B bookmark, [ ] previous/next moment), double-click or F for
  fullscreen with its own control bar (markers, seek, volume, speed, Add clip, Bookmark).
- **Clips.** One click on a moment cuts a clip. It opens in its own window where you can trim it,
  give it a title and notes, and draw on the video.
- **Notes.** Tag what went wrong and write notes per moment and per game.

### Safe for your account

Nothing touches the game process. The app never injects into, hooks or reads the memory of
League, never sends input, and installs no drivers, so it is compatible with Vanguard.

- **Video:** Windows Graphics Capture with the hardware encoder.
- **Events:** Riot's local Live Client Data API (`127.0.0.1:2999`), which is read-only.
- **After the game:** the League Client's match history (read-only).
- **Coaching:** all analysis is shown after the game, per Riot policy. There is no in-game
  overlay, no cloud upload and no Overwolf.

Recordings stay on your PC (`%APPDATA%\@lvr\desktop\recordings`). A storage quota (50 GB by
default) deletes the oldest unpinned games first.

## Publishing a release

Releases are built by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml))
on a Windows runner:

1. Bump `version` in `apps/desktop/package.json`, commit and push to `main`.
2. Run `npm run release`. It tags the commit `v<version>` and pushes the tag.
3. The workflow then:
   1. Typechecks and runs the tests.
   2. Fetches the LGPL FFmpeg build.
   3. Builds the recorder and the installer.
   4. Publishes the release with the installer and the list of commits since the last tag.

The **Release** workflow can also be started by hand from the Actions tab. It builds the
installer as a downloadable artifact without publishing anything.

## Development

```
apps/desktop/        Electron + React + TypeScript (main, preload, renderer)
packages/core/       lifecycle state machine, LCU client, Live Client poller, moments engine, SQLite store
packages/recorder/   Rust sidecar: WGC capture -> Media Foundation H.264/AAC, JSON lines over stdio
packages/schema/     zod types for 2999 / LCU payloads + fixtures from real captures
tools/               event-dump, recorder bake-off, PresentMon harness, FFmpeg fetch, release script
docs/                PLAN.md, ADRs, research
```

**You need:**

- Node 22.12 or later.
- Rust (stable, MSVC toolchain).
- FFmpeg in `tools/bin`, fetched with
  `powershell -ExecutionPolicy Bypass -File tools\fetch-ffmpeg.ps1`. This downloads BtbN's LGPL
  build and refuses GPL builds, because the installer bundles it.

Everything builds and runs on Windows. Windows Graphics Capture, port 2999 and the League
Client are not reachable from WSL. The source can still be edited from WSL and the commands run
through `cmd.exe /c "cd /d C:\path\to\lol-vod-review && ..."`.

```
npm install
npm run dev                     # build the packages and start the app with hot reload
npm test                        # unit tests (core + desktop)
npm run typecheck
npm run smoke -w apps/desktop   # end-to-end smoke test of the built app
npm run dist                    # local installer -> apps/desktop/release/
```

Notes:

- The recorder links the C runtime statically (`packages/recorder/.cargo/config.toml`), so users
  need no VC++ redistributable.
- The app allows a single instance. Close the installed or running copy before starting
  `npm run dev`.

Plan: [`docs/PLAN.md`](docs/PLAN.md). Research: [`docs/research/`](docs/research/).
