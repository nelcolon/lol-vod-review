# lol-vod-review

Windows desktop tool that auto-records every League of Legends game and, after the game,
surfaces the moments worth reviewing (your deaths first, then objective swings, then kills),
each opening 30-60 s before the trigger so you review the decision, not the outcome.

- Nothing touches the game process: Windows Graphics Capture + hardware encoder, events from
  Riot's local Live Client Data API (`127.0.0.1:2999`) and the League Client (LCU).
- All coaching happens post-game (Riot policy). No overlay, no cloud, no Overwolf.

Plan: [`docs/PLAN.md`](docs/PLAN.md). Research: [`docs/research/`](docs/research/).

## Layout

```
apps/desktop/        Electron + React + TypeScript (main, preload, renderer)
packages/core/       lifecycle state machine, LCU client, Live Client poller, clock mapper, moments engine
packages/recorder/   Rust CLI sidecar (WGC -> hardware H.264), JSON-lines over stdio
packages/schema/     zod types for 2999 / LCU payloads + fixtures from real captures
tools/               Phase 0 spikes: event-dump, recorder bake-off, PresentMon harness
docs/                PLAN.md, ADRs, research
```

## Developing

Source is edited from WSL but **built and run on the Windows host** (WGC, port 2999 and the
LCU are not reachable from WSL). From WSL: `cmd.exe /c "cd /d C:\Users\ncolo\dev\lol-vod-review && npm run dev"`.
