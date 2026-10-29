# @lvr/desktop — Electron shell

The Windows desktop app: tray process, review UI, `lvr-media://` video protocol, clip export.
Phase 1/2 scaffold from `docs/PLAN.md` §3.7/§3.8. Everything the UI shows today comes from a
`MockBackend`; `@lvr/core` plugs in behind the `Backend` interface (see below).

## Running (from WSL, executing on Windows)

Node/npm must run on the Windows host (WGC, port 2999 and the LCU are not reachable from WSL).
Edit from WSL, run through `cmd.exe`:

```bash
cd /mnt/c/Users/ncolo/dev/lol-vod-review
W='cd /d C:\Users\ncolo\dev\lol-vod-review && '
cmd.exe /c "$W npm install"                       # once; also unpacks the Electron binary
cmd.exe /c "$W npm run dev -w apps/desktop"       # electron-vite dev: HMR renderer + Electron
cmd.exe /c "$W npm run typecheck -w apps/desktop" # tsc for main/preload and renderer
cmd.exe /c "$W npm test -w apps/desktop"          # vitest: range parser, timeline math
cmd.exe /c "$W npm run build -w apps/desktop"     # production bundle into apps/desktop/out
cmd.exe /c "$W npm run smoke -w apps/desktop"     # build + launch with LVR_SMOKE=1 (see below)
cmd.exe /c "$W npm run dist -w apps/desktop"      # NSIS installer via electron-builder (Phase 4)
```

If `node_modules/electron/dist/electron.exe` is missing after an install (postinstall skipped),
run `cmd.exe /c "cd /d C:\...\node_modules\electron && node install.js"`.

If several agents/terminals share the root lockfile, wrap npm in `flock /tmp/lvr-npm.lock …`.

### Test video

The player needs `apps/desktop/dev-assets/sample.mp4` (git-ignored). Generate it with the
bundled FFmpeg (2 min, 1080p60 H.264 NVENC, 1 s GOP, burned-in `hh:mm:ss` timecode):

```bash
cd /mnt/c/Users/ncolo/dev/lol-vod-review
./tools/bin/ffmpeg.exe -y -f lavfi -i testsrc2=size=1920x1080:rate=60 -t 120 \
  -vf "drawtext=text='%{pts\:hms}':fontsize=72:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=16:x=(w-text_w)/2:y=h-th-80" \
  -c:v h264_nvenc -preset p4 -b:v 12M -g 60 -bf 0 -pix_fmt yuv420p -movflags +faststart \
  'apps\desktop\dev-assets\sample.mp4'
```

(Run `ffmpeg.exe` directly from WSL as above; passing the `drawtext` filter through `cmd.exe /c`
mangles the quotes.) The burned-in timecode is how you check that a marker labelled 1:05 seeks
to 00:01:05 + the mock's 4 s loading offset.

### Smoke test

`LVR_SMOKE=1` makes the main process run `src/main/smoke.ts` after the renderer loads: it drives
the real page through `webContents.executeJavaScript` (IPC round trips, `HEAD`/`Range`/`416`/`403`
on `lvr-media://`, opens the first game, waits for `<video>` metadata, seeks to 65.5 s, counts
timeline markers and rail moments), prints one JSON line per check and exits 0/1. It is the only
automated end-to-end check; nothing here can be inspected visually from a terminal.

## Architecture

```
src/
  shared/          plain TS shared by all three processes (no runtime deps)
    contracts.ts   Game, Segment, EventRow, Moment, Clip, Note, Settings, RecorderStatus (PLAN §3.5/§3.6)
    ipc.ts         IPC channel names, the LvrApi type of window.lvr, lvr-media:// URL helpers
    range.ts       HTTP Range parsing (unit-tested)
    timeline-math.ts time <-> pixel math, formatting, prev/next moment, frame step (unit-tested)
  main/            Electron main process (Node)
    index.ts       single-instance lock, window (hide-to-tray), autostart, CSP, createBackend() seam
    backend.ts     the Backend interface
    mock-backend.ts fake library: 3 games, events, rule-based moments, persisted notes/tags/clips
    media-protocol.ts lvr-media://local/<encoded path>, Range -> 206, roots whitelist
    clips.ts       ffmpeg -ss -to -c copy
    ipc.ts         ipcMain.handle for every channel + pushes (recorder status, settings)
    settings.ts    settings.json in app.getPath('userData'), sanitised
    tray.ts        tray icon (procedural, colour = recorder state) + menu Open / Recording / Quit
    smoke.ts       LVR_SMOKE=1 self-test
  preload/         contextBridge.exposeInMainWorld('lvr', api) — typed by shared/ipc.ts; lvr.d.ts
  renderer/        React 19 + Zustand, plain CSS (dark only)
    src/store.ts   route, games, bundle, settings, recorder status, player state, filters, toast
    src/views/     Library, GameView, SettingsView
    src/components/ Timeline (two lanes, moment windows, draggable playhead, tooltips),
                   MomentsRail (ranked list + theme/lane filters), MomentCard (prompt, cause tags,
                   note, jump 60 s earlier, export clip), NotesPanel, StatusBar
    src/lib/       player.ts (controller around the bare <video>), useKeyboard.ts, format.ts
```

Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; the renderer only
sees `window.lvr`. `lvr-media://` serves files only under `Backend.mediaRoots()` (dev-assets,
recordings, clips). A strict CSP header is added when packaged; dev skips it for Vite HMR.

### Time conventions

`gameTimeS` is the Live Client clock (0 at `GameStart`); everything named `*Ms` is video time
inside a segment (`<video>.currentTime`). The clock mapper in core produces `EventRow.videoTMs`.
The timeline positions markers by `videoTMs`; titles/tooltips show game time.

### Keyboard (game view)

Space play/pause · J/K/L back 10 s / pause / forward 10 s · `,` `.` frame step (1/fps) ·
`[` `]` previous/next moment (seeks to the window start) · 1–4 speed 1×/1.5×/2×/4× ·
B bookmark note at the current time · Esc back to the library · Ctrl+Enter saves the note.

## The Backend seam

`src/main/backend.ts`:

```ts
interface Backend {
  start(); stop();
  listGames(); getGame(id): GameBundle | null;      // {game, segments, events, moments, notes, clips}
  saveNote(input); deleteNote(id); setTags(momentId, tags); markReviewed(momentId);
  addClip(row);                                     // persist after clips.ts wrote the file
  getRecorderStatus(); onRecorderStatus(cb);        // idle | recording | post_processing
  applySettings(settings);                          // recording toggle, queues, pre-roll, bitrate
  mediaRoots(): string[];                           // directories lvr-media:// may serve
}
```

`createBackend()` in `src/main/index.ts` is the only place that knows about `MockBackend`.
When `@lvr/core` is ready, add a `CoreBackend` that maps core's SQLite rows onto
`shared/contracts.ts` (or re-export core's types there), drives the lifecycle state machine and
recorder sidecar, and reports recorder status; swap it in `createBackend()`. IPC, preload and
renderer stay untouched.

Mock specifics: every segment is `dev-assets/sample.mp4`, so mock games are ~2 minutes with
video t = game t + 4 s, and the mock moments engine uses 12 s pre-roll / 4 s post-roll / 6 s
clustering instead of PLAN's 45 / 10 / 15 s. Notes, tags, reviewed flags and clips persist in
`%APPDATA%\lol-vod-review\mock-state.json` (dev: `%APPDATA%\Electron\…` unless the app name is
set); settings in `settings.json` next to it; clips are written to `<userData>\clips\`.

## Not done yet

- Real recordings / segments across reconnects (clip export always uses segment 0).
- Thumbnails / hover-scrub sprite, pin/delete, retention quota UI feedback, trends view.
- Installer build (`electron-builder.yml` is written but untested), code signing.
