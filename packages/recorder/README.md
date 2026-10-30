# lvr-recorder

Recorder sidecar for LoL VOD Review (backend A in `docs/PLAN.md` §3.2, `docs/adr/ADR-002-recorder-backend.md`).
DXGI Desktop Duplication of the League window's monitor, cropped to the window (`src/dup.rs`), or
Windows Graphics Capture of the window (via the `windows-capture` crate) → Media Foundation
H.264/HEVC + AAC in MP4. The Electron core spawns it and talks JSON lines over stdin/stdout.

Vanguard rules (PLAN §2.1): DXGI duplication or WGC with a window handle or monitor only. The game process is never opened
beyond `PROCESS_QUERY_LIMITED_INFORMATION`; no injection, no hooks, no input, no window messages.

## Build and test (Windows host, not WSL)

```bat
cd /d C:\Users\ncolo\dev\lol-vod-review\packages\recorder
cargo build --release          :: target\release\lvr-recorder.exe
cargo test                     :: 27 unit tests (protocol, detector, audio timing, QPC)
target\release\lvr-recorder.exe --self-test --seconds 10            :: primary monitor
target\release\lvr-recorder.exe --self-test --process "League of Legends.exe" --seconds 120
```

`--self-test` prints a `SELFTEST OK|FAIL ...` verdict on stderr and the protocol events on stdout. See
`--help` for all flags. `--list-windows` / `--list-monitors` print one event and exit.

## Protocol

One JSON object per line. Commands on stdin (`cmd`), events on stdout (`ev`). Field names are camelCase.

### Commands

| `cmd` | Fields | Notes |
|---|---|---|
| `start` | `out` (required), `target`, `fps` (60), `bitrateMbps` (12), `width`/`height` (null = first frame size), `audio` `{game: true, mic: false, micVolume: 100}` (mic gain %, 0–400), `cursor` (false), `border` (false), `codec` (`h264` \| `hevc`), `capture` (`auto` \| `dxgi` \| `wgc`) | One session at a time |
| `stop` | — | Finalizes the MP4, replies `stopped` |
| `status` | — | Replies `status` |
| `list-windows` / `list-monitors` | — | Replies `windows` / `monitors` |

`target` is one of `{"hwnd":N}`, `{"pid":N}`, `{"windowTitle":"…"}`, `{"processName":"…"}`,
`{"monitor":N}`. Default: `{"processName":"League of Legends.exe"}` (largest window of that exe).

```
→ {"cmd":"start","target":{"hwnd":123},"out":"C:\\rec\\game.mp4","fps":60,"bitrateMbps":12,"audio":{"game":true,"mic":false}}
← {"ev":"started","qpcStart":…,"qpcFreq":10000000,"wallStart":"2026-…Z","encoder":"h264_mf","width":1920,"height":1080,…}
← {"ev":"stats","frames":120,"dropped":0,"t":2.0,"fpsActual":60.0,"lastFrameAgeMs":4,"audioSeconds":2.0}
← {"ev":"warning","code":"black_frames","t":31.2}
→ {"cmd":"stop"}
← {"ev":"stopped","durationMs":…,"path":"C:\\rec\\game.mp4","frames":…,"dropped":…,"reason":"stop"}
```

### Events

| `ev` | When |
|---|---|
| `ready` | Once at process start: `version`, `pid` |
| `started` | First frame captured and encoder open. `qpcStart` = QPC of the first encoded frame (DXGI `LastPresentTime` or WGC `SystemRelativeTime`); this is video t=0 for the clock mapper. `captureMethod`: `dxgi` or `wgc` |
| `stats` | Every ~2 s while recording |
| `warning` | Edge-triggered (start and clear): `black_frames[_cleared]`, `frozen_frames[_cleared]`, `window_minimized`/`window_restored`, `size_changed`, `no_frames_yet`, `audio_unavailable`, `mic_unavailable`, `mic_unsupported`, `scale_unavailable`, `*_setting_unsupported`, `capture_fallback` (DXGI could not start, using WGC), `focus_lost`/`focus_restored` (DXGI: the card is recorded meanwhile), `duplication_lost`/`duplication_restored` |
| `stopped` | After `stop`, stdin EOF, Ctrl+C, or the window closing (`reason`: `stop`, `stdin_eof`, `interrupt`, `capture_ended`) |
| `error` | `bad_command`, `already_recording`, `not_recording`, `target_not_found`, `no_frames`, `finalize_failed` |

Closing stdin ends the session cleanly, so if the Electron process dies the recording is still finalized.

## Capture method (`capture`)

- **`auto` (default): DXGI Desktop Duplication**, falling back to WGC (`capture_fallback` warning) when
  duplication cannot start (no DXGI output for the monitor, rotated monitor, Remote Desktop...).
  `dxgi` fails instead of falling back; `wgc` forces WGC.
- Why: WGC capture of the window (or monitor) makes DWM compose the game, so it loses independent
  flip. PresentMon on the 7800X3D + RTX 4080 at 1440p/240 Hz, Practice Tool, 2026-10-30
  (`tools/bakeoff/Run-PerfAB.ps1 -Compare methods`): WGC window 1 % low −3.6 % and +9.5 ms
  present-to-display; DXGI duplication kept independent flip, 1 % lows at baseline, +0 ms.
- Duplication copies the composed monitor image and crops it to the game's client area on the GPU, so
  the output size is the client area. It sees whatever is on screen: while League is not the
  foreground window it records a "League of Legends is not in focus" card (Direct2D, drawn once)
  instead. The card also covers reconnects after `DXGI_ERROR_ACCESS_LOST` (mode change, UAC, fullscreen
  switch). Frames are paced on a fixed 60 fps grid; a quiet screen repeats the last frame.
- One D3D11 device on the monitor's adapter for the whole session, with multithread protection on: the
  MF transcoder reads our textures from its own threads (without the lock, ~2/3 of runs hung at stop).
- Needs `VideoEncoder::send_directx_surface`, added in the vendored crate (`vendor/README.md`).
- `LVR_DUP_TRACE=1` prints a step-by-step trace on stderr.

## Output (measured 2026-10-29, `--self-test`, ffprobe)

- H.264 Main, CFR 60 fps (WGC delivers only changed frames; the MF sink repeats frames to keep the rate constant), AAC-LC 48 kHz stereo 192 kbps.
- **Keyframe every 1.000 s.** Seeks and `-c copy` cuts are precise to one second.
- Encoder: Media Foundation picks the hardware MFT; on this PC the video-encode load lands on the RTX 4080
  (NVENC). `encoderHw` in `started` lists every hardware H.264 MFT in merit order (here two AMD iGPU
  entries come first because of the Ryzen 7800X3D's integrated Radeon); it is *not* the one in use, as
  the crate does not expose that.
- `firstFrameLatencyMs` can be a few ms negative: WGC's `SystemRelativeTime` is the composition target
  time, which can be slightly ahead of QPC at callback time. Irrelevant to the ±250 ms marker target.

## Known limits

- **Not crash-safe.** The file is a plain MP4 (`ftyp, mdat, moov`); the `moov` index is written by
  `stop`. If the recorder process itself is killed, Windows crashes, or power is lost, that recording is
  unplayable ("moov atom not found"). An Electron crash is fine (stdin EOF → finalize). Fragmented MP4 is
  not reachable through `windows-capture` 2.0.1: its WinRT `MediaTranscoder` rejects the `FMPEG4`
  container (E_INVALIDARG) and the `MPEG2` (program stream) container stalls after one frame. Accepted
  for v1 (decision 2026-10-29); if it bites, rotate segments and concat post-game.
- Not faststart: `moov` is at the end. Local playback is fine; the post-game step may remux with
  `ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`.
- Audio is **system loopback** (default render endpoint): everything you hear is recorded, Discord and
  music included. This is intended (decision 2026-10-29).
- `audio.mic: true` mixes the default recording device into the same AAC track (`audioMode`
  `system_loopback+mic`). The loopback thread is the clock; each buffer it sends gets as many mic
  frames mixed in (saturating add, mic buffer capped at 500 ms), and with the mic on it fills
  silence when the system makes no sound so the voice keeps flowing. A mic that cannot be opened
  emits `mic_unavailable` and recording continues without it; `mic` without `game` emits
  `mic_unsupported`. `--self-test --mic` tries it.
- No scaling: the output size is locked to the first frame (or `width`/`height`); later size changes are
  cropped or padded on the GPU path (`size_changed` warning).
- Black and frozen-frame detection is unit-tested on synthetic grids only, not against a real black capture.
