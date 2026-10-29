# ADR-002: Recorder backend

Status: proposed — decided by the Phase 0 bake-off (`tools/bakeoff`)

## Candidates
A. Rust CLI on the `windows-capture` crate (WGC by HWND -> Media Foundation H.264, audio built in, QPC timestamps)
B. FFmpeg CLI: `gfxcapture` (WGC, FFmpeg 8.1+) or `ddagrab` (DXGI) -> `h264_nvenc`/`h264_amf`/`h264_qsv`
C. User's OBS via obs-websocket v5 (opt-in power-user mode, later)

## Measurements to record (fill in)
| Backend | FPS cost in League (PresentMon) | GPU enc util | A/V sync | Fullscreen OK | Alt-tab OK | Notes |
|---|---|---|---|---|---|---|
| A | | | | | | |
| B gfxcapture | | | | | | |
| B ddagrab | | | | | | |

## Findings and decisions so far (2026-10-29, before the League bake-off)
- Backend A output: H.264 Main CFR 60, 1.000 s keyframe interval, AAC 48 kHz stereo; encode load on the
  RTX 4080 (NVENC via MF), not the 7800X3D iGPU. Details in `packages/recorder/README.md`.
- **Crash safety: accepted plain MP4 for v1.** `windows-capture` 2.0.1 cannot write fragmented MP4
  (`FMPEG4` → E_INVALIDARG; `MPEG2` stalls). Electron dying is covered (stdin EOF finalizes the file);
  a recorder crash, BSOD, or power loss loses that game. Fallback if it happens in practice: rotate segments, concat post-game.
  This replaces the "fragmented MP4, crash loses ≤1 s" line in PLAN §3.2 for backend A.
