# ADR-001: Application shell is Electron + TypeScript

Status: accepted (2026-10-29)

## Context
Solo developer strongest in JS/Python; target is Windows 10/11 only; the app needs a tray
background process, local HTTP polling, SQLite, a video player with a marker timeline, and
must drive a native capture sidecar. Alternatives considered: Tauri 2, .NET/WinUI, Overwolf.

## Decision
Electron (main process in TypeScript owns lifecycle, pollers, DB, sidecars; renderer is
React + TypeScript). Capture is never linked into the Electron process: it runs in a separate
`recorder` executable with a JSON-lines stdio contract (see PLAN.md §3.2).

## Consequences
- Chromium guarantees H.264 hardware decode; recordings are H.264 to stay playback-safe.
- ~150 MB install / ~100 MB idle RAM accepted. Tauri remains the fallback if footprint matters.
- Overwolf rejected: its 2026-11-01 monetization mandate and its events wrap the same 2999 API.
- Build and run happen on the Windows host, never inside WSL.
