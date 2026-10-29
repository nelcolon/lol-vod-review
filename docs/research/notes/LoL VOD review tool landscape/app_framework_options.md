# Application framework and distribution options for a Windows LoL auto-recorder + VOD review app (state as of 2026-10-29)

> Method note for the report writer: the session-wide WebSearch budget was exhausted before this researcher started, so findings come only from (a) direct WebFetch of primary docs (Microsoft Learn, Riot developer portal, Overwolf docs, Tauri docs), and (b) live GitHub API data via `gh` (stars, last push, latest release, queried 2026-10-29). No third-party blog benchmarks (e.g. Tauri vs Electron RAM) could be retrieved. Statements in "Inferences" that rely on general engineering knowledge rather than a fetched source are marked **[background knowledge, unverified this session]**.

### Ecosystem snapshot (GitHub API, queried 2026-10-29)
| Project | Stars | Latest release | Last push | Notes |
|---|---|---|---|---|
| tauri-apps/tauri | 112,299 | tauri-cli-v2.12.4, 2026-10-21 | 2026-10-28 | Rust + system WebView — [repo](https://github.com/tauri-apps/tauri) |
| electron/electron | 123,620 | v45.1.0, 2026-10-27 | 2026-10-29 | — [repo](https://github.com/electron/electron) |
| AvaloniaUI/Avalonia | 31,729 | 12.1.4, 2026-10-09 | 2026-10-29 | — [repo](https://github.com/AvaloniaUI/Avalonia) |
| microsoft/WindowsAppSDK (WinUI 3) | 4,714 | v2.6.4, 2026-10-27 | 2026-10-29 | — [repo](https://github.com/microsoft/WindowsAppSDK) |
| videojs/video.js | 40,037 | video.js@10.2.0, 2026-10-22 | 2026-10-29 | "Video.js v10 - open source media player framework for HTML and React" — [repo](https://github.com/videojs/video.js) |
| vidstack/player | 3,695 | (no GH release) | 2026-10-07 | Repo description: **"Deprecated in favour of Video.js 10; security fixes only until January 2028."** — [repo](https://github.com/vidstack/player) |
| sampotts/plyr | 29,989 | v3.8.5, 2026-10-06 | 2026-10-21 | Repo description: **"Deprecated in favour of Video.js 10; security updates only."** — [repo](https://github.com/sampotts/plyr) |
| mpv-player/mpv | 37,618 | v0.41.0, 2025-12-21 | 2026-10-29 | libmpv embedding option — [repo](https://github.com/mpv-player/mpv) |
| NiiightmareXD/windows-capture | 523 | (no GH release object) | 2026-10-05 | "Fastest Windows Screen Capture Library For Rust And Python" (WGC-based) — [repo](https://github.com/NiiightmareXD/windows-capture) |
| sskodje/ScreenRecorderLib | 502 | v7.0.1, 2026-09-05 | 2026-10-27 | ".NET library for screen recording... using native Microsoft Media Foundation for realtime encoding to h264" — [repo](https://github.com/sskodje/ScreenRecorderLib) |
| obsproject/obs-studio | 78,565 | 33.0.0, 2026-10-23 | 2026-10-28 | — [repo](https://github.com/obsproject/obs-studio) |
| zmwangx/rust-ffmpeg (ffmpeg-next) | 2,020 | v9.0.0, 2026-08-05 | 2026-10-09 | — [repo](https://github.com/zmwangx/rust-ffmpeg) |
| Ruslan-B/FFmpeg.AutoGen | 1,611 | v8.0.0.1, 2026-03-14 | 2026-08-22 | — [repo](https://github.com/Ruslan-B/FFmpeg.AutoGen) |
| BtbN/FFmpeg-Builds | 11,891 | rolling "latest", 2026-10-28 | 2026-10-28 | Windows GPL and LGPL builds — [repo](https://github.com/BtbN/FFmpeg-Builds) |
| fraxiinus/ReplayBook | 456 | 1.7.9, 2025-09-01 | 2026-10-08 | C#; "Play, manage, and inspect League of Legends replays" — [repo](https://github.com/fraxiinus/ReplayBook) |
| MathewSachin/Captura | 10,869 | v8.0.0, **2018-11-10** | 2026-05-25 | Effectively unmaintained releases — [repo](https://github.com/MathewSachin/Captura) |
| aza547/wow-recorder | 233 | — | 2026-10-29 | TypeScript/Electron; "records and saves videos of in-game World of Warcraft encounters, and provides a graphical user interface to view the replays... no adverts" — closest OSS architectural analogue — [repo](https://github.com/aza547/wow-recorder) |

---

## Q1. Which stack minimizes risk for a solo developer strong in Python/JS/web, working from WSL, targeting Windows (time-to-MVP, native API access, binary size, idle footprint)?

### Takeaway
For a web-strong solo dev, the two realistic choices are **Electron** (fastest MVP, everything in JS/TS, bundled Chromium with known codecs, proven by wow-recorder's exact use case) and **Tauri 2** (small binary/idle footprint, Rust backend gives first-class access to WGC via `windows-capture` and FFmpeg via `ffmpeg-next`, but adds Rust learning cost and depends on the system WebView2). .NET/WinUI/Avalonia/Qt/Flutter would require learning a new UI stack and give up the web skill set; they only win if native video playback is a hard requirement. Recording itself is best done by a native component (Rust crate, OBS/libobs, or an FFmpeg sidecar) regardless of shell.

### Cited Findings
- Tauri 2 is actively released: tauri-cli v2.12.4 on 2026-10-21, 112k stars — [GitHub API: tauri-apps/tauri](https://github.com/tauri-apps/tauri)
- Electron is on v45.1.0 (2026-10-27) — [GitHub API: electron/electron](https://github.com/electron/electron)
- Tauri Windows installers: MSI (WiX v3) "can **only be created on Windows**"; NSIS `-setup.exe` is the option for cross-compiling from Linux/macOS, "possible with caveats," less tested, recommended only as a last resort after VMs/CI; needs NSIS, LLVM/LLD, `x86_64-pc-windows-msvc` target and `cargo-xwin` — [Tauri v2: Windows installer](https://v2.tauri.app/distribute/windows-installer/)
- Tauri WebView2 install modes and installer-size impact: `downloadBootstrapper` (default, +0 MB, needs internet), `embedBootstrapper` (+~1.8 MB), `offlineInstaller` (+~127 MB), `fixedVersion` (+~180 MB), `skip` (not recommended) — [Tauri v2: Windows installer](https://v2.tauri.app/distribute/windows-installer/)
- WebView2 Evergreen runtime "will be included as part of the Windows 11 operating system"; "The vast majority of Windows 10 devices have the WebView2 Runtime installed already" but a small number don't, so apps should check (registry `pv` key under `EdgeUpdate\Clients\{F3017226-...}` or `GetAvailableCoreWebView2BrowserVersionString`) — [Microsoft Learn: WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- Evergreen WebView2 apps share one runtime copy, and "binaries for Microsoft Edge and the Evergreen WebView2 Runtime are hard-linked together when they are on the same version... benefits for disk footprint, memory, and performance" — [Microsoft Learn: WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- A long-running (tray) WebView2 app keeps using the old runtime after an Evergreen update until all WebView2 environment objects are released or the app restarts; handle `NewBrowserVersionAvailable` — relevant to an always-on background recorder — [Microsoft Learn: WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- Fixed Version WebView2 binaries are "over 250 MB"; on Windows 10, unpackaged apps using Fixed Version ≥120 must run `icacls` grants for AppContainer SIDs — [Microsoft Learn: WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- Native capture libraries available: `windows-capture` (Rust + Python, WGC) — [repo](https://github.com/NiiightmareXD/windows-capture); `ScreenRecorderLib` v7.0.1 (2026-09-05) for .NET, Media Foundation H.264 encoding — [repo](https://github.com/sskodje/ScreenRecorderLib)
- FFmpeg bindings: `ffmpeg-next` (rust-ffmpeg) v9.0.0, 2026-08-05 — [repo](https://github.com/zmwangx/rust-ffmpeg); FFmpeg.AutoGen v8.0.0.1, 2026-03-14 (unsafe auto-generated bindings) — [repo](https://github.com/Ruslan-B/FFmpeg.AutoGen)
- .NET UI options are alive: Avalonia 12.1.4 (2026-10-09) — [repo](https://github.com/AvaloniaUI/Avalonia); Windows App SDK v2.6.4 (2026-10-27) — [repo](https://github.com/microsoft/WindowsAppSDK)
- wow-recorder (TypeScript, Electron-based desktop recorder that auto-records WoW encounters and has a replay-viewer GUI, ad-free) is actively maintained (push 2026-10-29) — [repo](https://github.com/aza547/wow-recorder)

### Inferences
- **Electron path (lowest risk to MVP):** whole app in TS; recorder via libobs (wow-recorder uses an OBS-based native module **[background knowledge, unverified this session]**) or an FFmpeg/`windows-capture`-Python sidecar; playback in bundled Chromium. Cost: ~100+ MB installer and a heavier idle footprint, mitigated by destroying the BrowserWindow when hidden and keeping only the main process + tray alive **[background knowledge]**.
- **Tauri path (best footprint, more Rust):** Rust core runs process watch, LCU/Live Client polling (reqwest with self-signed cert acceptance), SQLite (rusqlite/sqlx), and capture via `windows-capture` + FFmpeg (sidecar binary or `ffmpeg-next`). The UI webview can be fully closed while the app sits in the tray (Tauri 2 has tray-icon support and plugins for autostart, updater, single-instance, shell/sidecar **[background knowledge — plugin names `tauri-plugin-autostart`, `tauri-plugin-updater`, `tauri-plugin-single-instance`, `tauri-plugin-shell`, `tauri-plugin-sql`; not re-verified this session]**). Installer typically a few MB plus optional WebView2 bootstrapper (sizes above).
- **WSL workflow:** Tauri can cross-build NSIS from Linux but officially "last resort"; MSI requires Windows. In practice, build/run natively on Windows (Rust/Node toolchains on the Windows side, editing from WSL via `\\wsl$` or vice-versa) or use GitHub Actions `windows-latest` for releases. Capture/WGC/LCU testing must happen on Windows anyway — WSL cannot see the game process.
- **.NET (WPF/WinUI 3/Avalonia):** best native interop (WGC via CsWinRT, Media Foundation, `MediaPlayerElement`, ScreenRecorderLib) and ReplayBook is C#/WPF prior art; but new language/UI framework for a web dev. WinUI 3 MSIX packaging adds friction for an unpackaged tray app **[background knowledge]**.
- **Flutter desktop / Qt:** no compelling advantage here; Qt (QtMultimedia, C++/PySide6) is viable for a Python dev but packaging PySide6 apps and LGPL compliance add work **[background knowledge]**.
- A pragmatic hybrid for a Python-strong dev: Tauri or Electron UI + a Python sidecar (PyInstaller) using `windows-capture`'s Python bindings. Downside: two runtimes to ship and sign, antivirus false positives common with PyInstaller one-file exes **[background knowledge]**.

### Gaps
- No 2025–2026 Tauri vs Electron idle-RAM/CPU benchmark could be fetched (search budget exhausted). Commonly cited figures (Tauri ~30–80 MB vs Electron ~100–200+ MB idle) are unverified this session.
- Did not verify current electron-builder / electron-updater / Squirrel versions or Tauri updater signature format.
- Flutter desktop and Qt current versions not checked.

---

## Q2. Can the review UI live in a WebView2 `<video>` with sub-second seeking on 1080p60 H.264, and what codec should recordings use?

### Takeaway
Yes, very likely — provided recordings are **H.264 (or HEVC only if you control HW), in MP4 with faststart or fragmented MP4, with a short keyframe interval (1–2 s)**. Chromium-based WebView2 plays H.264 natively via hardware decode; seek latency is dominated by GOP length, so short GOPs make scrubbing feel instant. For the player chrome, note that **Vidstack and Plyr are now deprecated in favour of Video.js 10**, so the forward-looking choices are Video.js 10 or a custom React/Svelte timeline over a bare `<video>`.

### Cited Findings
- Video.js v10 is the current line (video.js@10.2.0, 2026-10-22), billed as "open source media player framework for HTML and React" — [GitHub: videojs/video.js](https://github.com/videojs/video.js)
- Vidstack: "Deprecated in favour of Video.js 10; security fixes only until January 2028." — [GitHub: vidstack/player](https://github.com/vidstack/player)
- Plyr: "Deprecated in favour of Video.js 10; security updates only." (last release v3.8.5, 2026-10-06) — [GitHub: sampotts/plyr](https://github.com/sampotts/plyr)
- WebView2 generally provides "the same web platform capabilities and update release cadence as the Stable channel of the Microsoft Edge browser" — [Microsoft Learn: WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- Microsoft's Edge-vs-WebView2 differences page lists no media/codec differences (unavailable web features are only Push Notifications, Web Payment API, Periodic Background Sync) — [Microsoft Learn: Edge vs WebView2 differences](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/browser-features)
- mpv latest release v0.41.0 (2025-12-21), actively developed — [GitHub: mpv-player/mpv](https://github.com/mpv-player/mpv)

### Inferences
- **[background knowledge, unverified this session]** Codec support: Edge/WebView2 and Electron's Chromium both decode H.264/AAC in MP4. HEVC in Edge/WebView2 requires a hardware HEVC decoder and (in Edge) the HEVC Video Extensions; Electron's Chromium supports HEVC only via platform HW decode. AV1 decodes in Chromium (dav1d software fallback), but software AV1 at 1080p60 costs noticeable CPU on mid-range machines and AV1 *encode* needs RTX 40+/RX 7000+/Arc. → **Record H.264** (NVENC/AMF/QSV) as default; optionally HEVC for disk savings with an H.264 proxy or fallback.
- **[background knowledge]** File-size budget: 1080p60 H.264 at ~12–20 Mbps → ~3–7 GB per 30–45 min game; HEVC ~30–40% smaller. Disk-quota/retention management is a required feature.
- **[background knowledge]** Seeking: set encoder keyframe interval to 1 s (60 frames) or 2 s; write MP4 with `moov` at front (or fragmented MP4 so a crash mid-game still yields a playable file — important for a recorder; OBS-style MKV is not playable in `<video>` without remux). Chromium seeks to the previous keyframe then decodes forward, so 1–2 s GOPs give sub-second seeks on local files. Serve the file via a custom protocol / asset handler that supports HTTP Range requests (Tauri `asset:` protocol or `convertFileSrc`; Electron `protocol.handle`) — lack of Range support breaks seeking.
- **[background knowledge]** Frame accuracy: `HTMLVideoElement.requestVideoFrameCallback()` (Chromium 83+) reports `mediaTime` per presented frame; frame-stepping is done by `currentTime += 1/60` while paused (approximate, can land on neighbouring frame). `playbackRate` 0.25–4× works; audio is pitch-corrected. Good enough for coaching review; not for frame-exact editing — do exact cuts in FFmpeg using timestamps.
- **[background knowledge]** Timeline markers: easiest is a custom component (canvas/SVG strip under the video) driven by the DB event list (kills, deaths, dragons, etc.), plus a thumbnail sprite sheet (VTT thumbnails) generated by FFmpeg after the game. Video.js has a markers/plugin ecosystem, but v10 is a rewrite so v7/v8 plugins (e.g. videojs-markers) may not port.
- **Native alternatives:** libmpv (frame-exact stepping, any codec incl. HEVC/AV1 software, MKV) embedded in a native window — strong for power users, but embedding under a webview needs a child HWND/composition trick and is fiddly in Tauri/Electron. WinUI `MediaPlayerElement`/Media Foundation: native, HW-accelerated, HEVC depends on the same Store extension. Neither is needed if recordings are H.264 MP4.

### Gaps
- Could not fetch current Microsoft docs on HEVC/AV1 in WebView2 or Chromium HEVC status; codec claims above are background knowledge.
- No measured seek-latency benchmarks for 45-min 1080p60 files in WebView2 found.

---

## Q3. Game lifecycle detection: what signals to use?

### Takeaway
Use a layered state machine: (1) process watch for `League of Legends.exe` (start/exit) as the cheap trigger to begin capture/pre-roll; (2) LCU `gameflow` phase (via lockfile port/token) for queue/game-type metadata, reconnect and end-of-game; (3) Live Client Data API at `https://127.0.0.1:2999/liveclientdata/` as the authoritative "in game" signal and source of events/timestamps. LCU is explicitly unsupported by Riot, so treat it as optional enrichment.

### Cited Findings
- Live Client Data API "provides a method for gathering data during an active game"; base `https://127.0.0.1:2999/liveclientdata/`; endpoints `allgamedata`, `activeplayer`, `activeplayername`, `activeplayerabilities`, `activeplayerrunes`, `playerlist`, `playerscores`, `playersummonerspells`, `playermainrunes`, `playeritems`, `eventdata`, `gamestats`; Riot recommends subset endpoints over `allgamedata` — [Riot Developer Portal: LoL docs](https://developer.riotgames.com/docs/lol)
- "The League of Legends client and the game client use a self-signed certificate for HTTPS requests" — accept it or pin Riot's root cert — [Riot Developer Portal: LoL docs](https://developer.riotgames.com/docs/lol)
- League Client (LCU) API: "This service is not officially supported for use with third party applications... no guarantees of full documentation, service uptime, or change communication"; developers should register/leave a note on their app in the Developer Portal — [Riot Developer Portal: LoL docs](https://developer.riotgames.com/docs/lol)
- "All products must be registered in, and audited by Riot Games through the Developer Portal"; "Any new features or changes to a product must be audited" — [Riot General Policies](https://developer.riotgames.com/policies/general)
- Overwolf's own LoL GEP notes useful edge cases: `matchEnd` is deprecated (use announcer victory/defeat or launcher game flow); no `matchOutcome`; `gameMode` data incorrect (use `queueID`); `teams` "may arrive late, as little as a few seconds before the loading screen ends"; PBE reports region "PBE"; `game_mode` distinguishes lol/tft/arena; `chat` must not be logged — [Overwolf GEP: League of Legends](https://overwolf.github.io/api/live-game-data/supported-games/league-of-legends)

### Inferences
- **[background knowledge, unverified this session]** Process detection: polling `CreateToolhelp32Snapshot`/`EnumProcesses` (or Rust `sysinfo`) every 1–2 s is simple and cheap; WMI `__InstanceCreationEvent`/`Win32_ProcessStartTrace` gives events but the trace class needs admin and WMI adds latency/overhead. Polling is the pragmatic choice. Window for capture: `FindWindow(class "RiotWindowClass")` / enumerate windows of the game PID; WGC `GraphicsCaptureItem` from HWND.
- **[background knowledge]** LCU: read `lockfile` in the League install dir (`LeagueClient:pid:port:password:https`), basic auth `riot:<password>`; `GET /lol-gameflow/v1/gameflow-phase` returns phases like `None, Lobby, Matchmaking, ReadyCheck, ChampSelect, GameStart, InProgress, Reconnect, WaitingForStats, PreEndOfGame, EndOfGame`; `/lol-gameflow/v1/session` gives queue id/map/game id; websocket `OnJsonApiEvent_lol-gameflow_v1_gameflow-phase` avoids polling. Post-game: `/lol-end-of-game/v1/eog-stats-block`.
- **[background knowledge]** Edge cases to design for: Live Client API returns 404/connection refused during loading screen (game process exists ~30–90 s before `gameTime` advances) → align video t0 to first `GameStart` event / `gameTime` offset, not process start; reconnects spawn a new game process — append segments to the same game record keyed by LCU gameId; remakes (early `GameEnd`, short duration → auto-flag/auto-delete); custom games & Practice Tool have Live Client API but queueId differs (practice tool has no LCU queue stats); replays (.rofl playback) and spectate launch the same exe — the Live Client API is reported to work in spectator/replay with limited `activeplayer` data, so detect via LCU phase (`None`/watching) and skip or tag; ARAM/Arena/TFT have different maps/events (TFT has no Live Client events of the same shape).
- Riot policy implication: register the product in the Developer Portal even though it's a local tool, especially if it uses LCU.

### Gaps
- Could not verify Live Client Data API behavior during replays/spectator (Riot page "doesn't say").
- No authoritative current LCU gameflow phase list fetched (community docs only, from memory).

---

## Q4. Clip operations: FFmpeg strategy, bundling and licensing

### Takeaway
Bundle a standalone **LGPL FFmpeg build** (e.g. BtbN `win64-lgpl` or `lgpl-shared`) as a sidecar process and drive it with CLI args; this is the least-risk path for licensing and stability. Use stream copy for quick clips (keyframe-aligned, near-instant if GOP is 1–2 s) and re-encode (NVENC/AMF/QSV via FFmpeg) only for frame-exact trims, highlight-reel concat with transitions, or GIF/compressed MP4 export.

### Cited Findings
- BtbN/FFmpeg-Builds publishes rolling Windows builds (latest 2026-10-28), widely used (11.9k stars) — [GitHub: BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)
- In-process binding options: ffmpeg-next v9.0.0 (2026-08-05) — [repo](https://github.com/zmwangx/rust-ffmpeg); FFmpeg.AutoGen v8.0.0.1 (2026-03-14) — [repo](https://github.com/Ruslan-B/FFmpeg.AutoGen)
- ScreenRecorderLib encodes H.264 via Media Foundation (alternative to FFmpeg for capture-side encoding on .NET) — [repo](https://github.com/sskodje/ScreenRecorderLib)

### Inferences
- **[background knowledge, unverified this session]** Licensing: FFmpeg is LGPL-2.1+ by default; enabling libx264/libx265/fdk etc. makes it GPL (fdk-aac non-free/undistributable). LGPL builds still include hardware encoders (`h264_nvenc`, `hevc_nvenc`, `h264_amf`, `h264_qsv`, `av1_nvenc`) and the native AAC encoder — sufficient for this app. With an LGPL sidecar exe you satisfy LGPL by shipping source offer/notice and not static-linking into a closed binary. Patents: H.264/HEVC encoding via GPU vendor encoders shifts most patent concerns to hardware/OS vendors; still not legal advice.
- **[background knowledge]** Commands: fast clip `ffmpeg -ss <t> -to <t2> -i in.mp4 -c copy -avoid_negative_ts make_zero out.mp4` (starts at nearest prior keyframe); exact clip re-encode `-c:v h264_nvenc -preset p5 -cq 23`; thumbnails/sprites `-vf fps=1/5,scale=160:-1,tile=10x10`; concat highlight reel via concat demuxer (same codec params, `-c copy`) or `concat` filter if re-encoding; GIF via `palettegen`/`paletteuse` two-pass. Run post-game jobs at low priority so they don't affect the next game.
- Sidecar vs bindings: CLI sidecar is crash-isolated and trivially replaceable; `ffmpeg-next`/AutoGen give finer control but tie you to FFmpeg ABI versions and add build complexity on Windows.

### Gaps
- Did not fetch FFmpeg's own legal page or BtbN variant list to confirm current lgpl/gpl variant names.

---

## Q5. Data layer: SQLite library and schema

### Takeaway
SQLite in WAL mode with one writer (the background service) is the obvious fit; pick the library native to the shell (rusqlite or sqlx for Tauri; better-sqlite3 for Electron main process; Microsoft.Data.Sqlite + Dapper/EF Core for .NET). Store video as plain files on disk, DB holds metadata and event timestamps.

### Cited Findings
- No sources fetched for this section this session (budget exhausted); see Inferences.

### Inferences
- **[background knowledge, unverified this session]** Libraries: `rusqlite` (sync, bundled SQLite feature), `sqlx` (async, compile-time checked queries), `tauri-plugin-sql` (sqlx-based, exposes SQL to JS); `better-sqlite3` (sync, fastest in Node, needs native rebuild per Electron ABI via electron-rebuild/prebuilds); Drizzle ORM works atop better-sqlite3; .NET: Microsoft.Data.Sqlite + Dapper (light) or EF Core (migrations).
- Suggested schema:
  - `games(id, riot_game_id, platform_id, queue_id, map_id, game_mode, champion, role, result, started_at, ended_at, duration_s, lcu_session_json, status[recording|complete|failed|remake])`
  - `recordings(id, game_id, path, codec, width, height, fps, bitrate, size_bytes, video_t0_offset_ms /* video time when gameTime=0 */, segment_index)` — multiple rows for reconnect segments
  - `events(id, game_id, game_time_s, type[ChampionKill|DragonKill|BaronKill|TurretKilled|Multikill|Ace|...], killer, victim, assisters_json, raw_json)` — from Live Client `eventdata` (has EventID, EventName, EventTime)
  - `snapshots(game_id, game_time_s, kda/gold/cs/level json)` optional periodic polling of `activeplayer`/`playerscores`
  - `clips(id, game_id, start_s, end_s, title, tags, export_path, created_at)`; `notes(id, game_id, game_time_s NULL, body_md, created_at)`; `tags`, `clip_tags`
  - FTS5 virtual table on notes for search.
- File layout: `%USERPROFILE%\Videos\<App>\<YYYY-MM>\<date>_<champion>_<queue>_<gameId>.mp4`, plus `thumbs/<gameId>.jpg|sprite.jpg|.vtt`, `clips/`. DB in `%APPDATA%\<App>\app.db`. Keep video path relative to a configurable library root so users can move drives.

### Gaps
- No sourced benchmarks or docs fetched for SQLite libraries.

---

## Q6. Open-source prior art to study

### Takeaway
The single best architectural analogue is **wow-recorder** (Electron/TypeScript, auto-records encounters, built-in replay viewer, ad-free, actively maintained). **ReplayBook** is the reference for LCU/replay handling in C#/WPF. OBS (libobs) is the reference recorder engine. LoL-specific OSS auto-clippers on GitHub are tiny/abandoned — no mature open-source Outplayed equivalent for LoL surfaced.

### Cited Findings
- aza547/wow-recorder: 233 stars, TypeScript, pushed 2026-10-29; "records and saves videos of in-game World of Warcraft encounters, and provides a graphical user interface to view the replays. It is free, open source and contains no adverts." — [GitHub](https://github.com/aza547/wow-recorder)
- fraxiinus/ReplayBook: C#, 456 stars, latest release 1.7.9 (2025-09-01), pushed 2026-10-08; "Play, manage, and inspect League of Legends replays" — [GitHub](https://github.com/fraxiinus/ReplayBook)
- obsproject/obs-studio 33.0.0 released 2026-10-23 — [GitHub](https://github.com/obsproject/obs-studio)
- MathewSachin/Captura: last release v8.0.0 in 2018 — not a living dependency — [GitHub](https://github.com/MathewSachin/Captura)
- GitHub search "league of legends recorder" returned only trivial repos: mfro/LeagueReplay (0 stars, 2015, C#) and diyorsattarov7/acta (0 stars, C++, pushed 2026-10-18, "A lightweight League of Legends recorder written in C++"); searches "lol clip live client data", "league replay highlights", "game recorder tauri" returned nothing — [GitHub search: mfro/LeagueReplay](https://github.com/mfro/LeagueReplay), [diyorsattarov7/acta](https://github.com/diyorsattarov7/acta)
- Capture building blocks: windows-capture (Rust/Python, WGC) — [GitHub](https://github.com/NiiightmareXD/windows-capture); ScreenRecorderLib (.NET/Media Foundation) — [GitHub](https://github.com/sskodje/ScreenRecorderLib)

### Inferences
- Study wow-recorder for: background process + combat-log trigger (analogous to Live Client polling), buffer/record lifecycle, disk-quota cleanup, and an Electron review UI with event markers.
- Study ReplayBook for LCU lockfile auth, replay (.rofl) parsing, and game-metadata display.
- Commercial references (Outplayed/Insights Capture on Overwolf, Medal, Blitz, Mobalytics) define user expectations (auto-highlights on kills/deaths/objectives, per-game timeline) — not open source.

### Gaps
- GitHub search via `gh` is weaker than web search; LoL auto-clipper repos with other names may exist but weren't found. No Tauri-based game recorder found.

---

## Q7. Overwolf vs standalone (Live Client Data API) — and overlays / Vanguard / Riot policy

### Takeaway
Overwolf gives a ready LoL event feed (GEP, which itself wraps `live_client_data`), recording/replay APIs and a store, but from **1 Nov 2026 Overwolf "will only approve apps that use Overwolf monetization"** (ads/subscriptions), plus approval process and platform dependency. Since the core LoL signals (Live Client Data API events, LCU gameflow) are available directly from Riot locally, and recording via WGC is a standard non-injecting technique, an MVP is better built **standalone**; Overwolf mainly buys an in-game overlay and a distribution channel.

### Cited Findings
- Overwolf LoL GEP features include `live_client_data` (active_player, all_players, events, game_data, port), `matchState` (matchStarted, matchId, queueID; `matchStart` event; `matchEnd` deprecated), kill/death/assist/respawn, announcer events (first_blood, multikill, turret_destroy, inhibitor_destroy, victory/defeat), damage, heal, gold, minions, jungle_camps, team_frames (ult cooldowns), chat, counters (`match_clock`) — [Overwolf GEP: League of Legends](https://overwolf.github.io/api/live-game-data/supported-games/league-of-legends)
- Overwolf GEP caveats: `gameMode` data incorrect; teams can arrive late; "Push runes/items features are not allowed by Riot in the KR region" — [Overwolf GEP: League of Legends](https://overwolf.github.io/api/live-game-data/supported-games/league-of-legends)
- `overwolf.media.replays`: captures "a **short** video replay of the currently running game"; `turnOn()` starts background replay capture; `capture()`/`startCapture()`/`stopCapture()`; auto-highlights via `highlights.enable` + `requiredHighlights` and `onHighlightsCaptured` (video path + event list + timing); `ReplayVideoOptions` incl. fps, width, height, max_kbps, `buffer_length` (up to 40 s), encoder via `StreamingVideoEncoderSettings` (from `overwolf.streaming`); `replayType` variants are obsolete, API as a whole not deprecated — [Overwolf: media.replays](https://overwolf.github.io/api/media/replays)
- ow-electron: Electron-based framework "offering an enhanced Electron experience" with core Overwolf APIs; apps can be standalone and "fully branded" with "no Overwolf branding"; **"Starting November 1, 2026, Overwolf will only approve apps that use Overwolf monetization"** (ads and subscriptions) — [Overwolf: ow-electron overview](https://dev.overwolf.com/ow-electron/getting-started/overview/)
- Riot policy on overlays: approved use cases include "Game overlays that provide static data that is available prior to the game"; "Products may not provide any game-session-specific information that would be previously unknown to the player"; "Products must not use or incorporate information not present in the game client" if it gives a competitive edge; cannot identify/analyze deliberately hidden players; no Augment/Arena item win rates (including overlays) — [Riot Developer Portal: LoL docs](https://developer.riotgames.com/docs/lol)
- Riot general policies: "You may not place advertisements in Riot properties, which include in-game"; "Products cannot create an unfair advantage for players, like a cheating program"; no MMR/ELO calculators; must have a free tier if monetized; registration + audit required — [Riot General Policies](https://developer.riotgames.com/policies/general)
- Riot's LoL developer page does not mention Vanguard — [Riot Developer Portal: LoL docs](https://developer.riotgames.com/docs/lol)

### Inferences
- **Trade-off table (for the writer):**
  - *Overwolf gains:* pre-built LoL event stream with richer fields (damage, jungle camps, ult timers) than raw Live Client API; tested capture/replay pipeline whitelisted with Riot/Vanguard; overlay API; store discovery; ow-electron lets you keep an Electron codebase.
  - *Overwolf costs:* mandatory Overwolf monetization for approval from 2026-11-01 (ads in an otherwise clean coaching tool); approval/review cycle for every release; dependency on Overwolf runtime/ow-electron and their GEP status outages; `media.replays` is designed for short buffered clips (≤40 s buffer), so full-game VOD needs `overwolf.streaming` recording anyway; user-sentiment risk around Overwolf bloat/ads **[background knowledge — sentiment not sourced this session]**.
  - *Standalone gains:* no ads requirement, full control, smaller footprint, Live Client `eventdata` covers the review-marker needs (kills, multikills, dragons, barons, heralds, turrets, inhibs, aces, game end).
  - *Standalone costs:* own capture engine, own Riot Developer Portal registration, no in-game overlay at MVP, LCU unsupported/may change.
- **Vanguard safety [background knowledge, unverified this session]:** WGC/DXGI desktop or window capture, reading the local Live Client API and LCU, and topmost non-injected windows do not touch the game process and are the same techniques OBS/Medal/Outplayed use; Vanguard targets injection/memory reading. Game-hook capture (OBS "game capture" style DLL injection) should be avoided. No Riot statement confirming this was fetched.
- **Overlay (future):** a click-through topmost transparent window (`WS_EX_LAYERED|WS_EX_TRANSPARENT|WS_EX_TOPMOST`, Tauri `transparent` + `set_ignore_cursor_events`, Electron `setIgnoreMouseEvents`) only renders over **borderless/windowed** League, not exclusive fullscreen **[background knowledge]**. Content must stay within Riot policy (static pre-game info; no info unknown to the player; no ads in-game).

### Gaps
- Could not fetch the ow-electron recording package docs (404 at guessed URL) or the Overwolf monetization/revenue-share terms.
- No primary Riot statement on Vanguard compatibility of third-party capture/overlays found.

---

## Q8. Cost/time to a signed installer that doesn't trigger SmartScreen

### Takeaway
**No certificate (OV, EV, or Artifact Signing) eliminates SmartScreen on day one anymore** — Microsoft states EV "no longer bypass[es] SmartScreen." The cheapest sound path is **Azure Artifact Signing (formerly Trusted Signing) from $9.99/month**, but individual developers must be in the **US or Canada** (organizations in US/CA/EU/UK/AU/NZ/JP/KR/SG/CH/NO/IL); otherwise buy an OV cert from a CA (HSM/cloud key required). Reputation then builds over "several weeks and hundreds of clean installs." The only zero-warning route is the **Microsoft Store**.

### Cited Findings
- "EV certificates no longer bypass SmartScreen... Paying a premium for EV solely to avoid SmartScreen warnings is no longer justified." OV/EV-signed new apps show an "unrecognized" warning with verified publisher name until reputation accumulates — [Microsoft Learn: SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- "There is no exact threshold, but it can take several weeks and hundreds of clean installs from a wide audience"; no manual submission mechanism for consumer reputation; signing with the same certificate lets reputation carry to new versions — [Microsoft Learn: SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- "Apps published through the Microsoft Store are re-signed by Microsoft and carry full reputation. Users will never see a SmartScreen warning" — [Microsoft Learn: SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- Windows 11 Smart App Control "will block execution of unsigned files unless the file has a positive reputation" — signing is essentially mandatory — [Microsoft Learn: SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- Artifact Signing "Starts at $9.99/month"; no hardware token; integrates with GitHub Actions/Azure DevOps; identity validation required — [Microsoft Learn: SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- Pricing page lists Basic = 5,000 signatures/month, 1 certificate profile of each type; Premium = 100,000 signatures/month, 10 profiles (dollar amounts rendered as placeholders when fetched) — [Azure: Artifact Signing pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
- Eligibility: "Public Trust certificates are available to organizations in the United States, Canada, the European Union, the United Kingdom, Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway, and Israel. Individual developers must be located in the United States or Canada." — [Microsoft Learn: Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- Org identity validation "takes from 1 to 20 business days (possibly longer...)"; individual validation is via Microsoft Entra Verified ID with AU10TIX ID + face check, and the Azure billing account must be type Individual with matching legal name/address — [Microsoft Learn: Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- Requires a paid Azure subscription (no free/trial/sponsored); not pro-rated; no custom CN/O; "Artifact Signing doesn't issue Extended Validation (EV) certificates" — [Microsoft Learn: Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
- Signing works with SignTool, PowerShell, GitHub Actions, or the Artifact Signing SDK; certificates are never handed to you (signed in service) — [Microsoft Learn: Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)

### Inferences
- Budget: Artifact Signing ≈ $120/yr (Basic) + 1–20 business days validation; OV certificate from a CA typically ~$200–$500/yr plus a cloud-HSM/token requirement since the 2023 CA/B Forum key-storage rule **[background knowledge, unverified this session]**; EV no longer worth it for SmartScreen.
- **Note for this user:** the user's other projects are Dominican Republic–based (arvision.do). The Dominican Republic is not on the Artifact Signing eligible-country list for either individuals or organizations, so unless they have a US/CA individual identity or an eligible-country organization, Artifact Signing is unavailable and an OV cert from a commercial CA (or Microsoft Store distribution) is the path.
- Microsoft Store (MSIX or, for Win32 apps, the Store's unpackaged EXE/MSI submission **[background knowledge]**) is the only immediate no-warning distribution; the Store developer account fee for individuals was dropped to free in 2025 **[background knowledge, unverified this session]**.
- Auto-update choices: Tauri `tauri-plugin-updater` (signed update manifests, NSIS/MSI); Electron `electron-updater` (electron-builder, NSIS) or Squirrel.Windows; .NET Velopack; MSIX App Installer auto-update **[background knowledge]**. Sign every binary in the package (app exe, sidecars like ffmpeg.exe, installer) so Smart App Control doesn't block sidecars.

### Gaps
- Exact Artifact Signing Premium price and overage price not retrievable (placeholders on pricing page).
- Current OV/EV certificate prices from CAs (DigiCert, Sectigo, SSL.com, Certum) not fetched.
- Microsoft Store individual developer fee status in 2026 not verified.
