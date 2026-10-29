# Riot-sanctioned data sources for detecting LoL in-game events and game state (Windows, as of Oct 2026)

Research note: the session's web-search budget ran out partway through, so some planned lookups (production-key turnaround, the full current EventName list, replay patch/retention rules) were not checked online. Most of what is below comes from primary pages: Riot's developer docs, the auto-generated Riot API OpenAPI spec, the auto-generated LCU schema (dysolix, built from LCU version 16.21.829.8620, repo pushed 2026-10-27), and source code from Riot's League Director and fraxiinus/ReplayBook. Anything taken from memory rather than a source is labelled UNVERIFIED and sits under Inferences or Gaps.

## Q1: Which source gives the lowest-latency, most complete event feed during a live game, and what does it miss?

### Takeaway
The Live Client Data API (HTTPS on 127.0.0.1:2999, served by the game process) is the only local, real-time, Riot-documented event feed. It gives named events with an `EventTime` in game seconds, plus a game clock. It is poll-only, uses champion/player *names* rather than IDs, and has no positions, damage or ward events. Riot documents only a small sample of the event types. The LCU (client) gives the lifecycle (gameflow phase) but not in-game events.

### Cited Findings
**Live Client Data API: endpoints and format**
- Base URL `https://127.0.0.1:2999`. "Only available locally for native applications." All endpoints are GET: `/liveclientdata/allgamedata`, `/activeplayer`, `/activeplayername`, `/activeplayerabilities`, `/activeplayerrunes`, `/playerlist`, `/playerscores?riotId=`, `/playersummonerspells?riotId=`, `/playermainrunes?riotId=`, `/playeritems?riotId=`, `/eventdata`, `/gamestats`. `gamestats` returns game mode, game time, map name, map number and terrain. Riot recommends the subset endpoints over `allgamedata` unless you need everything — [Riot Dev Docs, LoL](https://developer.riotgames.com/docs/lol)
- Riot ID migration: "Any endpoints that took a SummonerName as a parameter now accepts only the `riotId` parameter." — [Riot Dev Docs, LoL](https://developer.riotgames.com/docs/lol)
- Swagger is served live at `https://127.0.0.1:2999/swagger/v2/swagger.json` and `/swagger/v3/openapi.json` — [Riot Dev Docs, LoL](https://developer.riotgames.com/docs/lol)
- Every event has `EventID`, `EventName` and `EventTime`. The docs inline only `GameStart` and link to a sample list — [Riot Dev Docs, LoL](https://developer.riotgames.com/docs/lol)
- Riot's official sample event list ([liveclientdata_events.json](https://static.developer.riotgames.com/docs/lol/liveclientdata_events.json)) contains exactly these events and fields:
  - `GameStart`
  - `MinionsSpawning`
  - `FirstBrick` {KillerName}
  - `TurretKilled` {TurretKilled: e.g. "Turret_T2_L_03_A", KillerName, Assisters[]}
  - `InhibKilled` {InhibKilled: e.g. "Barracks_T2_R1", KillerName, Assisters[]}
  - `DragonKill` {DragonType: e.g. "Earth"/"Elder", Stolen: "False" (a string, not a bool), KillerName, Assisters[]}
  - `HeraldKill` {Stolen, KillerName, Assisters[]}
  - `BaronKill` {Stolen, KillerName, Assisters[]}
  - `ChampionKill` {VictimName, KillerName, Assisters[]}
  - `Multikill` {KillerName, KillStreak: 2..5}
  - `Ace` {Acer, AcingTeam: "ORDER"/"CHAOS"}
- The official sample has no `FirstBlood`, `GameEnd`, `HordeKill` (Voidgrubs) or Atakhan event — [liveclientdata_events.json](https://static.developer.riotgames.com/docs/lol/liveclientdata_events.json)
- Voidgrubs: in practice the API sends void grub kills as `EventName: "HordeKill"`. A 2025-26 player-side collector maps `DragonKill`, `BaronKill`, `HeraldKill` and `HordeKill` to objective types and reads `killerName`, `DragonType` and `stolen` — [jyaniee/league-studio-agent](https://github.com/jyaniee/league-studio-agent)
- Atakhan: `AtakhanKill` appears in one tournament relay's list of included events, next to ChampionKill, turret kill/respawn, inhibitor kill/respawn, Baron and multikill. The same project says event documentation is incomplete and that DragonKill was missing from its list — [uniliga/uniliga-lol-relay](https://github.com/uniliga/uniliga-lol-relay). A French overlay project leaves AtakhanKill/HordeKill out of its whitelist because it has not checked them against a real capture — [open-lol-companion PR #137](https://github.com/bolitow/open-lol-companion/pull/137)
- The community also reports turret and inhibitor *respawn* events, but gives no exact strings — [uniliga/uniliga-lol-relay](https://github.com/uniliga/uniliga-lol-relay)
- The `allPlayers` objects include `isDead`, `respawnTimer`, `team`, `position` (this is the lane/role string, not map coordinates), `scores`, items, level, runes and summoner spells. They do not include ability cooldowns — [uniliga/uniliga-lol-relay](https://github.com/uniliga/uniliga-lol-relay)
- Riot gives no polling interval. Community collectors default to 1000 ms (`POLL_INTERVAL_MS=1000`) — [Riot Dev Docs](https://developer.riotgames.com/docs/lol); [league-studio-agent](https://github.com/jyaniee/league-studio-agent)
- The game client and League client use a self-signed certificate. Riot publishes the root at [riotgames.pem](https://static.developer.riotgames.com/docs/lol/riotgames.pem), and `curl --insecure` is fine for local testing — [Riot Dev Docs, LoL](https://developer.riotgames.com/docs/lol)
- Spectator/replay: in spectator mode `activePlayer` holds whichever player is selected. One community author is unsure whether this holds in replays and in live spectate — [uniliga/uniliga-lol-relay](https://github.com/uniliga/uniliga-lol-relay). The endpoint only answers while the game client is running and connected to a game — [league-studio-agent](https://github.com/jyaniee/league-studio-agent)

**Official status**
- Riot documents the Game Client API (Live Client Data and Replay) on its developer portal — [Riot Dev Docs](https://developer.riotgames.com/docs/lol). For the League Client (LCU) section, the same page says: "This service is not officially supported for use with third party applications… We provide no guarantees of full documentation, service uptime, or change communication for unsupported services." — [Riot Dev Docs, LoL](https://developer.riotgames.com/docs/lol)

**LCU (League Client): lifecycle and post-game**
- Connection: read the `lockfile` in the client install directory. It holds one line, `ProcessName:PID:Port:Password:Protocol`. Alternatively, parse `--app-port=` and `--remoting-auth-token=` from the `LeagueClientUx.exe` command line. Auth is Basic `riot:<token>`. Port and token change on every client restart. The lockfile location "can change!" The certificate is self-signed — [HextechDocs](https://hextechdocs.dev/getting-started-with-the-lcu-api/)
- Gameflow phases (`/lol-gameflow/v1/gameflow-phase`): `None, Lobby, Matchmaking, CheckedIntoTournament, ReadyCheck, ChampSelect, GameStart, FailedToLaunch, InProgress, Reconnect, WaitingForStats, PreEndOfGame, EndOfGame, TerminatedInError`. `/lol-gameflow/v1/session` also exists — [dysolix LCU schema v16.21](https://github.com/dysolix/hasagi-types)
- Post-game and identity endpoints in the current schema: `GET /lol-end-of-game/v1/eog-stats-block`, `/lol-end-of-game/v1/gameclient-eog-stats-block` (GET/POST), `/lol-summoner/v1/current-summoner`, `/lol-match-history/v1/products/lol/current-summoner/matches`, `/lol-match-history/v1/products/lol/{puuid}/matches`, `/lol-match-history/v1/games/{gameId}`, `/lol-match-history/v1/game-timelines/{gameId}`. The client's own highlights feature is at `/lol-highlights/v1/highlights`, `/config` and `/highlights-folder-path` — [dysolix LCU schema](https://github.com/dysolix/hasagi-types)
- Community LCU rules: no shop, chat or auth interaction; no automating what Riot doesn't want (ready check, picks/bans); use the official Riot API where it overlaps; don't expose hidden data; register the app on the developer portal — [dysolix LCU schema info block](https://github.com/dysolix/hasagi-types); [HextechDocs](https://hextechdocs.dev/getting-started-with-the-lcu-api/)

### Inferences
- For kill, death and objective timestamps, the best design is to poll `/liveclientdata/eventdata` at about 0.5–1 s (dedupe on `EventID`) together with `/gamestats`. The LCU websocket or gameflow-phase gives the outer lifecycle. Kill/death attribution needs a name-to-player map: `KillerName`/`VictimName` hold Riot IDs or summoner names for champions, and internal names (minion, turret) for non-champion killers. Build the map from `/playerlist`.
- What the live feed misses: map coordinates, damage breakdowns, gold/xp diffs, ward place/kill events, item purchases, level-ups, and (in the official sample) first-blood and game-end events. match-v5 timeline (Q3) fills most of these after the game.
- UNVERIFIED (from memory, not confirmed online in this session): community dumps also show `FirstBlood` {Recipient}, `InhibRespawningSoon`/`InhibRespawned` {InhibRespawned}, `GameEnd` {Result: "Win"/"Lose"} and `ChampionKill`/`Multikill` as above. Capture a real `eventdata` dump to confirm these, plus `HordeKill`/`AtakhanKill` payloads and the dragon types added recently (e.g. "Chemtech", "Hextech").

### Gaps
- No authoritative, current list of all EventNames. Riot's sample stops before Voidgrubs (added 2024) and Atakhan (added 2025). Their exact payloads could not be confirmed from a primary source.
- Behaviour in replays and spectator mode is not stated by Riot. Community reports are inconclusive.
- Riot gives no polling guidance or rate limit for port 2999.

## Q2: How do you map EventTime (game seconds) to wall-clock recording time robustly?

### Takeaway
`EventTime` and `gamestats.gameTime` share one in-game clock, measured in seconds. The robust approach: poll `gameTime` repeatedly, pair each sample with a monotonic wall-clock timestamp, and fit offset = wall − gameTime. Re-anchor whenever the delta stops advancing (pause), and treat the `GameStart` event, not the first moment the API answers (loading screen), as t≈0.

### Cited Findings
- Every event carries `EventTime`. `gamestats` exposes the current game time — [Riot Dev Docs, LoL](https://developer.riotgames.com/docs/lol)
- `GameStart` and `MinionsSpawning` are explicit events — [liveclientdata_events.json](https://static.developer.riotgames.com/docs/lol/liveclientdata_events.json)
- Riot's docs do not state the unit of EventTime. Community authors flag this as undocumented — [uniliga-lol-relay](https://github.com/uniliga/uniliga-lol-relay)
- LCU gameflow moves `GameStart → InProgress → WaitingForStats/PreEndOfGame → EndOfGame`, which brackets the game process lifetime — [dysolix LCU schema](https://github.com/dysolix/hasagi-types)
- match-v5 timeline events carry both `timestamp` (game ms) and `realTimestamp`. The `GAME_END` event carries `realTimestamp`/`winningTeam`, and the match info has `gameStartTimestamp`/`gameEndTimestamp`. That allows a post-hoc cross-check of wall time — [Riot API OpenAPI spec (match-v5.EventsTimeLineDto)](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json)

### Inferences
- Recommended algorithm:
  1. Start the recording when the gameflow phase becomes `InProgress`, or when port 2999 starts answering.
  2. Poll `/gamestats` every 250–500 ms and record (monotonic_wall, gameTime) pairs.
  3. Pairs where gameTime hasn't changed between polls indicate the loading screen (gameTime ≈ 0) or a pause. Drop them from the fit and start a new segment when the clock resumes.
  4. Map an event to video time with video_t = wall_at_record_start_offset + (EventTime − gameTime_anchor) inside the current segment.
  5. Event lists are cumulative, so dedupe by EventID. Late-arriving events are still placed correctly because EventTime is absolute game time.
- Plan for ±1 poll interval of anchor error. Using the least-squares slope over many samples (should be ≈1.0) absorbs HTTP jitter.

### Gaps
- No Riot documentation on how `gameTime` behaves during pauses, chronobreak or reconnects. This needs empirical testing.

## Q3: What does match-v5 timeline add after the game that the live API lacks?

### Takeaway
`GET /lol/match/v5/matches/{matchId}/timeline` (regional routing) returns per-frame participant snapshots (positions, gold, xp, CS, damage stats, champion stats) and a rich event stream. Events include map positions, damage received/dealt per kill, bounties, wards, items and skill-ups, keyed by participantId with ms timestamps. New since 2024–25: RSO-gated endpoints, including one that lists the player's replay file URLs.

### Cited Findings
- Endpoints: `/lol/match/v5/matches/by-puuid/{puuid}/ids`, `/lol/match/v5/matches/{matchId}`, `/lol/match/v5/matches/{matchId}/timeline` (platforms americas/asia/europe/sea) — [Riot API OpenAPI spec](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json)
- `InfoTimeLineDto`: `frameInterval`, `frames[]`, `participants`, `gameId`, `endOfGameResult`. `FramesTimeLineDto`: `timestamp`, `events[]`, `participantFrames{1..N}` — [OpenAPI spec](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json)
- `ParticipantFrameDto`: `championStats`, `currentGold`, `damageStats`, `goldPerSecond`, `jungleMinionsKilled`, `level`, `minionsKilled`, `participantId`, `position`, `timeEnemySpentControlled`, `totalGold`, `xp` — [OpenAPI spec](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json)
- `EventsTimeLineDto` fields: `timestamp`, `realTimestamp`, `type`, `participantId`, `itemId`, `afterId`/`beforeId`, `goldGain`, `levelUpType`, `skillSlot`, `level`, `creatorId`, `wardType`, `killerId`, `victimId`, `assistingParticipantIds`, `position`, `bounty`, `shutdownBounty`, `killStreakLength`, `multiKillLength`, `killType`, `victimDamageDealt`, `victimDamageReceived`, `victimTeamfightDamageDealt`, `victimTeamfightDamageReceived` (newer), `teamId`, `killerTeamId`, `laneType`, `monsterType`, `monsterSubType`, `buildingType`, `towerType`, `transformType`, `winningTeam`, `actualStartTime`, `featType`/`featValue` (newer; Feats of Strength, 2025), `name` — [OpenAPI spec](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json)
- RSO-only endpoints: `GET /lol/match/v5/matches/replays` ("Get player replays by access token", returns `ReplayDTO {total, matchFileURLs[]}`), plus a separate `lol-rso-match-v1` (`/lol/rso-match/v1/matches/ids` "Includes custom matches", `/matches/{matchId}`, `/matches/{matchId}/timeline`). Both require OAuth scope `openid` — [OpenAPI spec](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json); [Riot APIs list](https://developer.riotgames.com/apis)
- Matchlist filter: `startTime` only works for matches after June 16, 2021. `count` ranges 0–100 — [OpenAPI spec](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json)
- The LCU also exposes `/lol-match-history/v1/game-timelines/{gameId}`. LCU replay schemas include a GAMHS timeline (`LolReplaysGAMHSEvent`: type, timestamp, killerId, victimId, position, assistingParticipantIds, buildingType, monsterType/SubType…; `LolReplaysGAMHSParticipantFrame`: position, currentGold, totalGold, level, xp, minionsKilled…; team `hordeKills`) — [dysolix LCU schema](https://github.com/dysolix/hasagi-types)

### Inferences
- Event `type` values (CHAMPION_KILL, CHAMPION_SPECIAL_KILL, ELITE_MONSTER_KILL, BUILDING_KILL, TURRET_PLATE_DESTROYED, WARD_PLACED, WARD_KILL, ITEM_PURCHASED/SOLD/DESTROYED/UNDO, SKILL_LEVEL_UP, LEVEL_UP, DRAGON_SOUL_GIVEN, OBJECTIVE_BOUNTY_PRESTART/FINISH, PAUSE_END, GAME_END, CHAMPION_TRANSFORM, FEAT_UPDATE) are not enumerated in the spec. That list is UNVERIFIED (from memory). `frameInterval` is typically 60000 ms (UNVERIFIED here).
- Practical use: after the game, refine live-API timestamps (game ms vs seconds) and attach kill positions and damage-received breakdowns to each clip. The LCU's `game-timelines` endpoint can supply the same data without a Riot API key for the logged-in user's games.

### Gaps
- No primary source fetched for the CHAMPION_KILL position semantics or the enumerated `type` values.

## Q4: Can replay playback be driven to re-render a clip at a chosen time and camera?

### Takeaway
Yes. With `EnableReplayApi=1` in game.cfg, the replay client on port 2999 accepts POSTs to `/replay/playback` (time, speed, paused), `/replay/render` (camera mode/position/rotation, FOV, fog of war, many UI toggles), `/replay/sequence` (keyframed camera/playback tracks) and `/replay/recording` (built-in encoder to a file with start/end/fps/resolution). Replays can be launched through the LCU (`POST /lol-replays/v1/rofls/{gameId}/watch`) or by running `League of Legends.exe "<path.rofl>"`. Since Vanguard (2024), direct exe launch fails with "Access Denied" unless Vanguard is stopped.

### Cited Findings
- The Replay API is off by default. Enable it with `EnableReplayApi=1` under `[General]` in `game.cfg`. Endpoints: `GET /replay/game` (process info); `GET/POST /replay/playback` (pause, current time, seek); `GET/POST /replay/render` (render properties); `GET/POST /replay/recording` (POST starts recording with a codec and output path); `GET/POST /replay/sequence` (apply keyframe sequences; an empty object clears). "League Director" is Riot's open-source example — [Riot Dev Docs, LoL](https://developer.riotgames.com/docs/lol)
- Field names used by Riot's League Director source ([riotgames/leaguedirector api.py](https://github.com/riotgames/leaguedirector/blob/master/leaguedirector/api.py), repo last pushed 2026-01-08):
  - `/replay/playback`: `paused`, `seeking`, `time`, `speed`, `length`
  - `/replay/recording`: `recording`, `path`, `codec`, `startTime`, `endTime`, `currentTime`, `width`, `height`, `framesPerSecond`, `enforceFrameRate`, `replaySpeed`
  - `/replay/render`, camera: `cameraMode`, `cameraPosition{x,y,z}`, `cameraRotation{x,y,z}`, `cameraAttached`, `cameraLockX/Y/Z`, `cameraMoveSpeed`, `cameraLookSpeed`, `fieldOfView`, `nearClip`, `farClip`
  - `/replay/render`, visibility: `fogOfWar`, `outlineSelect`, `outlineHover`, `floatingText`
  - `/replay/render`, interface toggles: `interfaceAll`, `interfaceReplay`, `interfaceScore`, `interfaceScoreboard`, `interfaceFrames`, `interfaceMinimap`, `interfaceTimeline`, `interfaceChat`, `interfaceTarget`, `interfaceQuests`, `interfaceAnnounce`, `interfaceKillCallouts`, `interfaceNeutralTimers`
  - `/replay/render`, health bars: `healthBarChampions`, `healthBarStructures`, `healthBarWards`, `healthBarPets`, `healthBarMinions`
  - `/replay/render`, scene: `environment`, `characters`, `champions`, `minions`, `particles`, `banners`, skybox, sun, depth/height fog and depth-of-field parameters
  - `/replay/sequence`: tracks such as `playbackSpeed` with keyframes `{time, value, blend}`
- LCU replay endpoints (current schema v16.21): `GET /lol-replays/v1/configuration` (`isReplaysEnabled`, `isReplaysForEndOfGameEnabled`, `isReplaysForMatchHistoryEnabled`, `isPatching`, `isInTournament`, `isPlayingGame`, `isPlayingReplay`, `gameVersion`, `minServerVersion`, `minutesUntilReplayConsideredLost`); `GET /lol-replays/v1/metadata/{gameId}` (`state`, `gameId`, `downloadProgress`); `POST /lol-replays/v1/rofls/{gameId}/download`, `/download/graceful`, `/watch` (body `{componentType}`); `GET /lol-replays/v1/rofls/path` and `/path/default`; `POST /lol-replays/v1/rofls/scan`; `POST /lol-replays/v2/metadata/{gameId}/create` — [dysolix LCU schema](https://github.com/dysolix/hasagi-types)
- Replay metadata `state` values: `checking, found, watch, download, downloading, incompatible, missingOrExpired, retryDownload, lost, unsupported, error`. `incompatible` is the patch-mismatch case and `missingOrExpired` covers the download window — [dysolix LCU schema](https://github.com/dysolix/hasagi-types)
- ReplayBook (fraxiinus; latest release 1.7.9 on 2025-09-01) launches `executable.TargetPath` (League of Legends.exe) with args `"<rofl path>" <LaunchArguments> "-Locale=<locale>"`, working directory set to the game folder — [ReplayBook LeagueExecutableExtensions.cs](https://github.com/fraxiinus/ReplayBook/blob/main/src/Executables.Old/Utilities/LeagueExecutableExtensions.cs); [releases](https://github.com/fraxiinus/ReplayBook/releases)
- After Vanguard arrived, users got "Access Denied" when opening replays directly (issue opened 2024-05-09). ReplayBook added a feature that stops the `vgk` service, which needs administrator rights (PRs #343, #350, 2025). Release 1.7.9 notes: "Disable Vanguard feature should now work more reliably" — [Issue #301](https://github.com/fraxiinus/ReplayBook/issues/301); [PR #350](https://github.com/fraxiinus/ReplayBook/pull/350); [VanguardServiceHelper.cs](https://github.com/fraxiinus/ReplayBook/blob/main/src/UI.Main/Utilities/VanguardServiceHelper.cs)
- "Replays from 14.9 through 14.10 do not contain metadata and are not supported by ReplayBook" — [ReplayBook README](https://github.com/fraxiinus/ReplayBook)

### Inferences
- A clip re-render pipeline: LCU `/watch` → wait for 2999 → POST `/replay/render` (camera, fog, interface flags) → POST `/replay/playback {time: T-10, paused:false}` → either screen-capture, or POST `/replay/recording {path, codec, startTime, endTime, width, height, framesPerSecond}`. Launching through the LCU avoids the Vanguard problem that a direct exe launch hits.
- UNVERIFIED (from memory): `.rofl` files go to `Documents\League of Legends\Replays` by default (query `/lol-replays/v1/rofls/path` to be sure). Replays only play on the patch they were recorded on. Server-side download is possible only for a limited window, roughly the current patch.

### Gaps
- No Riot support article fetched on replay retention or eligible queues (the support URLs redirect to a generic hub).
- Whether `/replay/recording` still works in 2026 builds is not confirmed (League Director is still maintained as of a Jan 2026 push).

## Q5: Is any of this gated by Riot approval, what do the policies forbid, and how long does a production key take?

### Takeaway
The local APIs (2999, LCU) need no key. Riot's policies still say "All products must be registered in, and audited by Riot Games through the Developer Portal", and that includes LCU-only apps. The Riot Web API needs a key: development keys expire every 24 h; personal keys allow 20 req/s and 100 per 2 min, for private use; production keys start at 500 per 10 s and 30,000 per 10 min, and need a working prototype plus review. Riot publishes no approval SLA.

### Cited Findings
- Key types:
  - Development: auto-issued, "deactivate every 24 hours".
  - Personal: private or small-community use, no public alpha/beta, no Tournaments API. Limits 20 req/1 s and 100 req/2 min.
  - Production: public products, starts at 500 req/10 s and 30,000 req/10 min, "Typically requires a working prototype". Limits are enforced per region.
  
  Source: [Riot Dev Portal docs](https://developer.riotgames.com/docs/portal)
- Process: read the policies → Register Product → submit the form → verify the product (not needed for personal) → Developer Relations reviews and replies through portal messages. Each product needs its own registration. Timeline "can vary depending on your project and the application's target region(s)." Riot rejects products that "solve" the game — [Riot Dev Portal docs](https://developer.riotgames.com/docs/portal)
- General policies:
  - "All products must be registered in, and audited by Riot Games through the Developer Portal"; feature changes are audited too.
  - No unfair advantage ("like a cheating program"); don't remove game decisions; no alternative MMR/ELO; no de-anonymizing.
  - One production key per product; keep keys out of distributed binaries.
  - Monetization requires registration and a free tier, and bans ads in Riot properties.
  - LCU apps must register too.
  
  Source: [Riot General Policies](https://developer.riotgames.com/policies/general)
- LCU: "not officially supported for use with third party applications… no guarantees of full documentation, service uptime, or change communication" — [Riot Dev Docs, LoL](https://developer.riotgames.com/docs/lol). Community guidance says use is allowed but may change or vanish without warning, and that you should use the Riot API for anything that overlaps and register the app — [HextechDocs](https://hextechdocs.dev/getting-started-with-the-lcu-api/)
- Riot support's third-party software stance forbids:
  - "Exposing information that's intentionally obfuscated"
  - "Taking actions on your behalf (botting or scripting)"
  - "Drawing conclusions for you during gameplay"
  - "Altering your field of intelligence (zoomhacks or global ult alerts)"
  
  Stat tracking is named as a good use; overlays, recording and memory reading are not mentioned — [Riot Support: Third-party applications](https://support.riotgames.com/en-us/riot/events/third-party-applications)
- Legal Jibber Jabber: a shared project must conspicuously state "[Project] was created under Riot Games' 'Legal Jibber Jabber' policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project." — [Riot Legal](https://www.riotgames.com/en/legal)
- RSO: match-v5 `/matches/replays` and `lol-rso-match-v1` need an RSO access token (scope openid) — [OpenAPI spec](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json)

### Inferences
- A local VOD recorder that only timestamps from 2999/LCU, shows markers *after* the game, and never reads memory or injects into the game fits the stated rules. Showing live in-game "conclusions" or timers as an overlay is the risky area ("Drawing conclusions for you during gameplay"). Memory reading and injection are inadvisable under Vanguard. Riot's pages say nothing explicit about either, but they are effectively blocked or detectable.
- Register the product on the Developer Portal even if you use only local APIs, and apply for a production key only if you call match-v5 for other users.

### Gaps
- No published production-key turnaround. Riot states none, and community reports could not be searched because the search budget ran out.
- The LoL-specific policy page (`/policies/lol`) returned 404. I found no "Riot Verified" program or Vanguard developer program in the pages fetched.
- No confirmation of 2025–2026 lockfile/Riot Client changes or removed LCU endpoints. The v16.21 schema still contains every endpoint listed above.
