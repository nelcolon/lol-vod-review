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
