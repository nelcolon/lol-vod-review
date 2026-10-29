# @lvr/event-dump

Phase 0 fixture recorder (PLAN.md §5 Phase 0 step 1). It polls the LCU gameflow phase and the
Live Client Data API on port 2999, and writes raw dumps to `fixtures/raw/<YYYYMMDD-HHMMSS>/`.
That folder is git-ignored because it contains real Riot IDs.

It must run on **Windows**. Port 2999 and the LCU are not reachable from WSL.

## Run

From WSL (one line):

```sh
cd /mnt/c/Users/ncolo/dev/lol-vod-review && cmd.exe /c "cd /d C:\Users\ncolo\dev\lol-vod-review && npm run start -w tools/event-dump -- --max-seconds 3600"
```

From a Windows terminal in the repo: `npm run start -w tools/event-dump -- [options]`.
`start` builds `@lvr/schema` and the tool first (`tsc -b`), then runs `node dist/cli.js`.
After a build you can also call `node tools/event-dump/dist/cli.js [options]` directly.

The root script `npm run event-dump` does not forward flags, because npm needs a second `--`.
Use the workspace form above when you pass options.

Start it before or during champ select and leave it running. It waits for the lockfile and
for `gameflow-phase` to reach `GameStart`/`InProgress`/`Reconnect`. Then it polls 2999 through
the loading screen until the game ends.

| Option | Default | |
|---|---|---|
| `--lockfile <path>` | `C:\Riot Games\League of Legends\lockfile` | re-read whenever the LCU stops answering |
| `--no-lcu` | off | skip the LCU and poll 2999 straight away (spectate/replay, or no client) |
| `--out <dir>` | `<repo>/fixtures/raw` | parent of the session folder |
| `--max-seconds <n>` | none | hard stop |
| `--live-url <url>` | `https://127.0.0.1:2999` | |
| `--tls riot-ca\|insecure` | `riot-ca` | `riot-ca` verifies the chain against `RIOT_CA_PEM` (hostname check skipped) and falls back to `insecure` on a TLS error, logged in probe.jsonl. The LCU always uses `rejectUnauthorized:false`. |
| `--quiet` | off | print only the final summary |

**Stops on:** `GameEnd` + 10 s; 2999 sending no HTTP response for 15 s after it has answered
once; `--max-seconds`; or Ctrl-C / SIGTERM. Files are flushed and `summary.json` is written in
every case. A second Ctrl-C forces the exit.

## Cadence

| What | Rate |
|---|---|
| LCU `/lol-gameflow/v1/gameflow-phase` | 1 Hz (plus `/lol-gameflow/v1/session` once per change into a game phase) |
| `/liveclientdata/gamestats`, `/eventdata` | 4 Hz |
| `/liveclientdata/playerlist`, `/activeplayername` | 1 Hz |

Each loop waits for its previous request before sending the next one, with a 2 s timeout and
keep-alive sockets. Every 2999 attempt, failures included, is stamped
`{ wallMs, hrtimeNs_start, hrtimeNs_end }`. The `hrtimeNs_*` values are
`process.hrtime.bigint()` written as decimal strings.

## Output files

| File | Contents |
|---|---|
| `gameflow.jsonl` | `{type:"phase", phase, prev, wallMs, iso, hrtimeNs}` on every phase change; `{type:"session", ...attempt}` |
| `gamestats.jsonl` | every `/gamestats` attempt: status (null = no HTTP response), body or `error.code`, stamps |
| `eventdata.jsonl` | `{type:"event", event, known, unknownReason?, idConflict?}` for each NEW event by `EventID`; `{type:"snapshot", why: periodic\|final, body}` with the full raw array on the first 200, every 30 s, and at stop |
| `playerlist.jsonl` | every `/playerlist` and `/activeplayername` attempt; `sameAsPrevious:true` replaces an unchanged body |
| `probe.jsonl` | every non-200 or failed 2999/LCU attempt (ECONNREFUSED, 404 during loading, ...), schema-validation failures, lockfile found/missing, TLS fallback, session start/end |
| `summary.json` | see below |

`summary.json` holds: the first HTTP response and first 200 per endpoint (loading-screen
behaviour, open question 4); status-code counts; when `GameStart` was first seen; `GameEnd`
result; gamestats mode/map and the estimated wall time of `gameTime` 0; `gameTime` stall
segments (≥1 s plateaus: loading, pause, reconnect) and regressions; the event histogram;
unknown event names and known names with invalid payloads (validated with `@lvr/schema`);
`EventID` conflicts and event-array shrinks (reconnect behaviour, open question 5); every
structure ID seen, parsed with `parseStructureId`, plus the unrecognised ones; non-champion
actor names (minion/turret/monster `KillerName`s, open question 6); and the end reason.

No credentials are written. The LCU password is used only in the `Authorization` header.

## Develop

```sh
npm run test -w tools/event-dump       # dedupe, summarizer, recorder with mocked fetch
npm run typecheck -w tools/event-dump
```
