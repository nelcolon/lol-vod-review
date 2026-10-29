# Gap-fill: Live Client Data event catalogue (2025-2026) and Vanguard vs capture software incidents (2024-2026)

Researched 2026-10-29. WebSearch was unavailable. Sources were reached through the GitHub API (`gh search code`, `gh api`, raw.githubusercontent.com), WebFetch on obsproject.com and support.riotgames.com, and the Arctic Shift Reddit archive API (arctic-shift.photon-reddit.com). reddit.com and old.reddit.com are blocked for both WebFetch and curl.
This file adds to `riot_data_sources.md` (Q1 gaps) and `vanguard_constraints.md` (sections 2-4 gaps). It does not repeat what those files already establish.

---

## Gap 1: Live Client Data API `/liveclientdata/eventdata` event catalogue

### Takeaway
Four sources agree on the 2025-2026 event set:
- the EventName string table in the signed 16.17 game binary,
- two community OpenAPI/type definitions (Irelia, clippi),
- two real `eventdata` captures committed in Jan 2026.

The events are: `GameStart, MinionsSpawning, FirstBlood, ChampionKill, Multikill, Ace, FirstBrick, TurretKilled, InhibKilled, InhibRespawningSoon, InhibRespawned, DragonKill, HordeKill, HeraldKill, BaronKill, AtakhanKill, GameEnd`.

Three facts are new relative to the existing notes:
1. **Structure ID format changed.** By about Jan 2026, structure IDs are `Turret_T100_L2_P3_<hash>` / `Inhib_T200_L1_P1_<hash>`. They are no longer `Turret_T2_L_03_A` / `Barracks_T2_R1`. A further variant, `Turret_TChaos_...` / `TOrder`, appeared by May-June 2026. **Parsers must accept all three.**
2. **`Stolen` exists on HordeKill and AtakhanKill too.** It is still the string "True"/"False".
3. **In spectator and replay mode, eventdata omits all epic-monster events and InhibKilled.** One project verified this on 2026-06-13. Kills, turrets, FirstBlood, Multikill and Ace still appear.

`GameEnd.Result` can be `Win`, `Lose` or `Neither`.

### Cited findings

**Full EventName set from the shipped binary (patch 16.17, researched 2026-09-02)**
- A string dump of `League of Legends.exe` (Riot-signed, patch `16.17.810.4348`) lists these EventName values: `GameStart, MinionsSpawning, ChampionKill, Multikill, DragonKill, HordeKill, HeraldKill, BaronKill, Ace, TurretKilled, InhibKilled, InhibRespawningSoon, InhibRespawned, FirstBrick, GameEnd`. `FirstBlood` is pooled elsewhere and was observed live.
- Fields found in the same dump: `EventID, EventName, EventTime, KillerName, VictimName, Assisters, Recipient, Stolen ("False"/…), DragonType, Acer, AcingTeam, KillStreak, Result`.
- `GameEnd` Result strings are "Win", "Lose" and **"Neither"**.
- The author verified live that `EventTime` is float seconds on the same clock as replay `Playback.time`.
- Source: [ssalbdivad/eepalytics .research/replay-capture.md §3.3](https://github.com/ssalbdivad/eepalytics/blob/HEAD/.research/replay-capture.md) (committed 2026-09-04).
- Caveat: `AtakhanKill` is not in that contiguous string block, but it does appear in real 2026 captures (below), so the block is not exhaustive.

**Real captured `eventdata` (Summoner's Rift, Jan 2026)**
- Source: [HatimFertat/lol_coach example_game_state.json](https://github.com/HatimFertat/lol_coach/blob/HEAD/src/lol_coach/data/examples/example_game_state.json), committed 2026-01-27. It is a CLASSIC game, Map11, gameTime 1940 s.
- Event counts: ChampionKill 59, TurretKilled 10, Multikill 6, DragonKill 5, HordeKill 3, Ace 2, plus one each of GameStart, MinionsSpawning, FirstBlood, FirstBrick, HeraldKill, AtakhanKill, BaronKill and InhibKilled.
- Verbatim samples:
  ```json
  {"EventID":1,"EventName":"MinionsSpawning","EventTime":65.02481079101562}
  {"Assisters":["EveryBotLoses"],"EventID":2,"EventName":"ChampionKill","EventTime":170.32275390625,"KillerName":"The Pongist","VictimName":"Froid3ur"}
  {"EventID":3,"EventName":"FirstBlood","EventTime":170.32275390625,"Recipient":"The Pongist"}
  {"Assisters":["DerAllerEchte69"],"DragonType":"Hextech","EventID":6,"EventName":"DragonKill","EventTime":393.75750732421875,"KillerName":"Kura8836","Stolen":"False"}
  {"EventID":12,"EventName":"Multikill","EventTime":514.4844970703125,"KillStreak":2,"KillerName":"MachDieBasics"}
  {"Assisters":["The Pongist","ramus balls"],"EventID":14,"EventName":"HordeKill","EventTime":569.1397705078125,"KillerName":"Kura8836","Stolen":"True"}
  {"Assisters":[],"EventID":17,"EventName":"HordeKill","EventTime":596.3905029296875,"KillerName":"The Pongist","Stolen":"False"}
  {"Assisters":[],"EventID":26,"EventName":"TurretKilled","EventTime":852.1474609375,"KillerName":"EveryBotLoses","TurretKilled":"Turret_T100_L2_P3_1509986696"}
  {"EventID":27,"EventName":"FirstBrick","EventTime":852.1474609375,"KillerName":"EveryBotLoses"}
  {"Assisters":["EveryBotLoses","The Pongist","ramus balls"],"EventID":49,"EventName":"AtakhanKill","EventTime":1254.9849853515625,"KillerName":"DontKillMyPookie","Stolen":"False"}
  {"Acer":"MachDieBasics","AcingTeam":"ORDER","EventID":68,"EventName":"Ace","EventTime":1540.2330322265625}
  {"Assisters":["MachDieBasics","DerAllerEchte69"],"EventID":80,"EventName":"BaronKill","EventTime":1692.0423583984375,"KillerName":"Kura8836","Stolen":"False"}
  {"Assisters":["Kura8836","DerAllerEchte69"],"EventID":92,"EventName":"InhibKilled","EventTime":1910.51708984375,"InhibKilled":"Inhib_T200_L2_P1_2351107073","KillerName":"MachDieBasics"}
  ```
- Observations from this capture:
  - `MinionsSpawning` fires at about 65 s.
  - `FirstBlood` shares its EventTime with the first ChampionKill, and `FirstBrick` shares its EventTime with the first TurretKilled. Dedupe or merge these rather than treating each as a separate highlight.
  - The 3 HordeKill events here are fewer than a full grub set. This fits Irelia's note below that the per-grub count is asymmetric.
- Turret IDs seen: `Turret_T100_L2_P3_1509986696`, `Turret_T200_L2_P3_2521511112`, `Turret_T100_L1_P3_1242677625`, `Turret_T200_L0_P3_511845594`, `Turret_T200_L1_P2_2237424422`, `Turret_T200_L0_P2_528623213`, `Turret_T200_L2_P2_2538288731`, `Turret_T200_L2_P1_2555066350`.
- The suffix appears to be a stable per-structure hash. The same ID, `Turret_T200_L1_P2_2237424422`, appears in both lol_coach captures.

**Real captured `eventdata` (Practice Tool, Jan 2026), with the inhibitor respawn cycle**
- Source: [HatimFertat/lol_coach monsters_game_state.json](https://github.com/HatimFertat/lol_coach/blob/HEAD/src/lol_coach/data/examples/monsters_game_state.json), committed 2026-01-27. gameMode `PRACTICETOOL`.
- Verbatim samples:
  ```json
  {"Assisters":[],"EventID":6,"EventName":"InhibKilled","EventTime":113.7707748413086,"InhibKilled":"Inhib_T200_L1_P1_1931666598","KillerName":"hisawt"}
  {"EventID":8,"EventName":"InhibRespawned","EventTime":413.73541259765625,"InhibRespawned":"Inhib_T200_L1_P1_1931666598"}
  {"Assisters":[],"DragonType":"Air","EventID":7,"EventName":"DragonKill","EventTime":315.88970947265625,"KillerName":"hisawt","Stolen":"False"}
  {"Assisters":[],"EventID":11,"EventName":"AtakhanKill","EventTime":1231.2259521484375,"KillerName":"hisawt","Stolen":"False"}
  {"Assisters":[],"DragonType":"Chemtech","EventID":12,"EventName":"DragonKill","EventTime":1497.78125,"KillerName":"hisawt","Stolen":"False"}
  {"Assisters":[],"EventID":13,"EventName":"InhibKilled","EventTime":1516.7154541015625,"InhibKilled":"Inhib_T200_L1_P1_1931666598","KillerName":"hisawt"}
  {"EventID":15,"EventName":"InhibRespawningSoon","EventTime":1801.7154541015625,"InhibRespawningSoon":"Inhib_T200_L1_P1_1931666598"}
  {"EventID":16,"EventName":"InhibRespawned","EventTime":1816.681640625,"InhibRespawned":"Inhib_T200_L1_P1_1931666598"}
  {"Assisters":[],"DragonType":"Elder","EventID":18,"EventName":"DragonKill","EventTime":2664.773193359375,"KillerName":"hisawt","Stolen":"False"}
  ```
- Timing: InhibKilled at 1516.7 s, `InhibRespawningSoon` at +285 s, `InhibRespawned` at +300 s. So the inhibitor respawn is 300 s, and RespawningSoon arrives 15 s before it.
- The payload key equals the EventName, and the value is the structure ID.
- DragonType values seen across both captures: `Air, Water, Fire, Earth, Hextech, Chemtech, Elder`.

**Type definitions that agree with these captures**
- [AlsoSylv/Irelia schemas/game.json](https://github.com/AlsoSylv/Irelia/blob/master/schemas/game.json) (OpenAPI):
  - `MonsterKillInfo` = {Stolen: enum "True"/"False", KillerName, Assisters[]}. It is shared by DragonKill (+DragonType), HordeKill, HeraldKill, BaronKill and AtakhanKill.
  - `GameEnd` = {Result: "Win"/"Lose"}, `FirstBlood` = {Recipient}, `InhibRespawned` = {InhibRespawned}.
- Irelia `types.rs` declares `DragonType { Fire, Earth, Water, Air, Hextech, Chemtech, Elder, Unknown }`.
- Irelia's doc-comment on grub counting: "unfortonetly the API only adds 1 event if the enemy kills them all, and one event for every grub your team kills". In other words, grub events are asymmetric from the active player's point of view. Source: [Irelia types.rs](https://github.com/AlsoSylv/Irelia/blob/master/irelia/src/in_game/types.rs).
- Irelia commit "Update for new turret IDs" (2026-05-14) adds `"TOrder"` and `"TChaos"` as team tokens alongside `T1/T100` and `T2/T200`. This shows a third naming generation by May 2026. Source: [commit 21f4cf9](https://github.com/AlsoSylv/Irelia/commit/21f4cf90d4430bd46e0a3a2bf51a208cb36d007f).
- [irusei/clippi LeagueTypes.ts](https://github.com/irusei/clippi/blob/HEAD/src/integration/league/LeagueTypes.ts) (a clip tool) defines `GameEnd{Result}`, `InhibRespawningSoon{InhibRespawningSoon}`, `InhibRespawned{InhibRespawned}` and `HordeKill{KillerName, Assisters, Stolen}`. Other projects define `InhibRespawningSoon` too: stelar7/R4J, stirante/lol-client-java-api, Leastrio/Shaco and soulspine/WildRune (GitHub code search, 2026-10-29).
- Irelia's own sample [events.json](https://github.com/AlsoSylv/Irelia/blob/master/irelia/src/in_game/events.json) (2024) uses the older IDs `Turret_T2_R_03_A`, `Turret_T2_C_01_A`, `Barracks_T1_C1`, `Barracks_T2_L1` and `{"EventName":"GameEnd","Result":"Win"}`.

**Structure ID formats (three generations)**

| Generation | Turret example | Inhibitor example | Source |
|---|---|---|---|
| Legacy (Riot sample, ≤2024) | `Turret_T2_L_03_A` (team T1/T2, lane L/C/R, place 01-05, `_A`) | `Barracks_T2_R1` | [Riot sample](https://static.developer.riotgames.com/docs/lol/liveclientdata_events.json), Irelia |
| Jan 2026 captures | `Turret_T100_L2_P3_1509986696` (team T100/T200, lane `L0/L1/L2`, position `P1..P3`, numeric hash) | `Inhib_T200_L1_P1_1931666598` | lol_coach captures |
| By May-June 2026 | `Turret_TChaos_L2_P3_…` (team TOrder/TChaos) | presumably `Inhib_TChaos_…` (not seen) | Irelia commit 2026-05-14, [OpenForestUI docs/api](https://github.com/bluestand-jp/OpenForestUI/blob/HEAD/docs/api/README.md) (scan 2026-06-13) |

- Which lane index maps to which lane (L0/L1/L2 against top/mid/bot) is **unconfirmed**.
- In the Practice Tool capture a single player killed L1 P3 → P2 → P1 → Inhib L1 within 2 minutes. That fits a mid-lane push (L1 = mid), but this is an inference.
- P3 is the outer turret and P1 the inhibitor turret: the solo push kills them in P3 → P2 → P1 order. Also an inference.
- How nexus turrets are named in the new scheme is unknown.

**Spectator and replay behaviour (answers the open question in riot_data_sources.md)**
- On 2026-06-13, the OpenForestUI author scanned every endpoint during a live spectate and a `.rofl` replay (CLASSIC, Map11, at 15:23 and 26:31):
  - `/eventdata` returned GameStart, MinionsSpawning, FirstBlood, ChampionKill (37), Multikill (5), Ace, FirstBrick and TurretKilled (4).
  - It returned **zero `DragonKill`, `HordeKill`, `BaronKill`, `HeraldKill`, `AtakhanKill` and `InhibKilled` events, even after a dragon had been taken.**
  - Live spectate behaves the same as `.rofl` replay, because live spectate is internally a delayed replay player.
  - In spectator mode, `TurretKilled.KillerName` can be a minion (`Minion_T100…`).
  - Source: [OpenForestUI docs/api/README.md §2.3](https://github.com/bluestand-jp/OpenForestUI/blob/HEAD/docs/api/README.md) (Japanese; translated here).
- In spectator mode, `/activeplayer`, `/activeplayerabilities` and `/activeplayerrunes` return HTTP 400 `{"errorCode":"RPC_ERROR","httpStatus":400,"message":"Spectator mode doesn't currently support this feature"}`. `/activeplayername` returns 200 `"Unknown"`, and `allgamedata.activePlayer` = `{"error":"Spectator mode doesn't currently support this feature"}`. Source: [OpenForestUI docs/api §2.5](https://github.com/bluestand-jp/OpenForestUI/blob/HEAD/docs/api/README.md). The binary also contains the string "Spectator mode and replay mode don't currently support this feature" ([eepalytics §3.4](https://github.com/ssalbdivad/eepalytics/blob/HEAD/.research/replay-capture.md)).
- When seeking in a replay, `/eventdata` and the player state rewind. OpenForestUI has to detect rewinds and rebaseline ([State.cs](https://github.com/bluestand-jp/OpenForestUI/blob/HEAD/OpenForestUI/Ingame/State/State.cs)).
- Overwolf staff (2025-06-02) said game events "were down due to a game update" for League replays ([r/Overwolf 1kynac7](https://reddit.com/r/Overwolf/comments/1kynac7/)). Replay event feeds therefore break on patches.
- The undocumented replay-only endpoint `GET /replay/events` is described in the binary as "Returns the replay's pre-indexed look-ahead moment events (kills, objectives, multikills, etc)". Its fields are `kind, moment, teamId, fromNameHash, toNameHash, fromCharacterName, toCharacterName, displayable, spawn`.
  - This is only verified from the binary; its runtime shape is unverified.
  - It may fill the objective gap during replays.
  - `/replay/*` returns 404 `{"errorCode":"RESOURCE_NOT_FOUND","httpStatus":404,"message":"Invalid URI format"}` during a live game. Source: [eepalytics §2.2](https://github.com/ssalbdivad/eepalytics/blob/HEAD/.research/replay-capture.md).

**KillerName values**
- For champions, KillerName is the bare Riot ID game name without the tag. OpenForestUI matches it against `riotIdGameName` ([State.cs GetKillerTeam](https://github.com/bluestand-jp/OpenForestUI/blob/HEAD/OpenForestUI/Ingame/State/State.cs)). All 2026 captures above show plain game names, including ones with spaces and non-ASCII characters ("Anzuelo de narón").
- Non-champion killers: `Minion_T100…` was observed as a TurretKilled killer in spectator mode in 2026 (OpenForestUI). A test fixture uses `"KillerName":"Turret_T2_L_03_A"` and `"Minion_T100L"` in Assisters, but it is **synthetic** ([MeioNeiz/meiolol session.zig](https://github.com/MeioNeiz/meiolol/blob/HEAD/src/lcu/session.zig)).
- I found **no real capture** of a ChampionKill by a turret, minion or monster, and no `SRU_*` killer string. GitHub code search for `SRU_Baron KillerName`, `Minion_T100 KillerName` and similar returned nothing.

**Polling, transport and availability**
- Riot gives no interval. The persisted examples found:
  - The existing notes record 1000 ms from league-studio-agent.
  - eepalytics measured round-trips on a live game of 10-33 ms per endpoint (gamestats 0.033 s, eventdata 0.010 s, playerlist 0.012 s). It warns against 10 Hz polling through one-shot `curl.exe` from WSL and recommends a persistent Windows-side helper ([eepalytics §1.3](https://github.com/ssalbdivad/eepalytics/blob/HEAD/.research/replay-capture.md)).
- Port 2999 responds only while a game, spectate or replay process is running, and "Ends entirely on exit" ([OpenForestUI §1](https://github.com/bluestand-jp/OpenForestUI/blob/HEAD/docs/api/README.md)).
- WSL2 cannot reach 2999 natively; it needs Windows interop (`curl.exe -sk`) ([eepalytics §1](https://github.com/ssalbdivad/eepalytics/blob/HEAD/.research/replay-capture.md)).
- The legacy LiveEvents API on port 34243 "was removed by Riot in patch 14.1", leaving `/eventdata` as the only event driver ([OpenForestUI State.cs comment](https://github.com/bluestand-jp/OpenForestUI/blob/HEAD/OpenForestUI/Ingame/State/State.cs)).
- I found no primary source giving the exact HTTP status during the loading screen (before GameStart). This is still a gap. The practical pattern in the sources is to poll until a 200 arrives with a `GameStart` event.

**Clip window defaults used by an existing clip tool** (useful prior art)
- [thirdnull/pack-league events-sources.json](https://github.com/thirdnull/pack-league/blob/HEAD/events-sources.json) uses these pre/post seconds per event:

  | Event | Pre (s) | Post (s) |
  |---|---|---|
  | ChampionKill | 10 | 5 |
  | Multikill | 12 | 5 |
  | Ace | 15 | 5 |
  | DragonKill | 15 | 5 |
  | BaronKill | 20 | 5 |
  | AtakhanKill | 20 | 5 |
  | HeraldKill | 15 | 5 |
  | TurretKilled | 5 | 3 |
  | InhibKilled | 8 | 5 |
  | GameEnd | 10 | 5 |

- Note that this tool uses a wrong grub event name, "VoidgrubKill". Another overlay (SaarMathew/SG_Overlay) also guesses aliases (`VoidGrubKill`, `VoidgrubKill`). **The real name is `HordeKill`.**

### Inferences
- An event parser should:
  - key on `EventName`, keep unknown events (log them), and treat `Stolen` as a string;
  - parse structure IDs with a tolerant regex such as `^(Turret|Inhib|Barracks)_(T1|T2|T100|T200|TOrder|TChaos)_(\w+?)_(?:P?(\d+)|0?(\d+))(?:_\w+)?$`;
  - resolve team from the structure ID rather than from KillerName, because minions can be the killer.
- For a recording or VOD tool that captures the **player's own live game**, the event feed is complete enough for kill, objective and structure markers.
- When **reviewing a replay or spectating**, do not rely on `/eventdata` for objectives. Either persist the live-game event log alongside the recording, or use match-v5 timeline / LCU `game-timelines` after the game. `/replay/events` is a candidate to test.
- Voidgrub counts from HordeKill are unreliable for the enemy team from the active player's point of view (Irelia). Prefer the match-v5 timeline for per-team grub counts.

### Gaps
- Exact HTTP status and body of `/liveclientdata/*` during the loading screen.
- A real example of a non-champion `KillerName` on ChampionKill (turret, minion, `SRU_*`, Atakhan).
- The exact current (TChaos-era) inhibitor ID string, and the L0/L1/L2 lane mapping.
- Whether HordeKill/AtakhanKill appear in `/replay/events`, and its runtime shape.
- Whether `GameEnd` ever fires with "Neither" in practice (remakes?).

---

## Gap 2: Vanguard vs capture, overlay and hardware software, dated incidents 2024-2026

### Takeaway
The biggest documented incident is **OBS 31.0 (Dec 2024) through OBS 31.1 (July 2025)**.
- **Cause:** OBS re-signed its game-capture hook with a new ECC certificate, and Riot Vanguard did not trust it.
- **Symptoms:** Game Capture of League either showed black, or made League drop to 0-2 FPS or freeze. The retry loop kept re-triggering Vanguard's signature check.
- **What was not affected:** the game still launched, and there were no VAN errors or bans.
- **Fixes:** Window Capture (WGC, "Windows 10 (1903 and up)"), Display Capture, or downgrading to OBS 30.2.3 and deleting `%ProgramData%\obs-studio-hook`. OBS **31.1.0 (2025-07-07)** shipped a dual-signed hook that "fixes game capture with games from Riot Games that use Vanguard".
- **Official statements:** OBS staff explained the mechanism on GitHub and the OBS KB. Riot never published one.

A second black-screen wave on **2026-07-21/22** coincided with the OBS 32.2.0 release. That release changed how the hook DLL loads, and 32.2.1 (2026-07-24) hotfixed "game capture failing after updating OBS if the previous hook was still in use". So the second wave was mostly an OBS update/hook issue, and possibly also a Riot update the same week.

Hardware and driver conflicts surface instead as **VAN errors or "Incompatible Software/Driver" blocks**. Examples: RTCore64.sys from MSI Afterburner / ASUS Armoury Crate, OEM storage and Wi-Fi drivers, Sophos endpoint (VAN 289, July 2026), and old BIOS on Windows 10 (vgk.sys BSOD, Jan 2026). In these cases the game refuses to start; it is not a capture failure.

### Dated incidents and statements (chronological)

| Date | Software | What broke | Fix / outcome | Source |
|---|---|---|---|---|
| 2024-05-02 | MSI Afterburner | Post title "MSI Afterburner getting destroyed by vanguard". The body was removed by mods, so no detail survives. | n/a. r/leagueoflegends removes tech posts and redirects to r/leagueoftechsupport. | [r/lol 1cis2zr](https://reddit.com/r/leagueoflegends/comments/1cis2zr/) |
| 2024-05-18 | Overwolf stat apps, AMD GPU drivers | LoL/Valorant FPS spikes from 300+ to 40 while any Overwolf in-game app runs, on recent AMD drivers | Overwolf staff asked for a ticket; unresolved | [r/Overwolf 1cuvwfy](https://reddit.com/r/Overwolf/comments/1cuvwfy/) |
| 2024-07-02 | Overwolf | Riot Support told a user to disable "Overwolfhelper", citing "reports" | Overwolf staff (Ori_Overwolf): "Overwolf shouldn't cause any problems with the game files" | [r/Overwolf 1dtlnym](https://reddit.com/r/Overwolf/comments/1dtlnym/) |
| 2024-12-07 | OBS 31.0.0 Game Capture | League/TFT in-game capture black; League stutters or lags while OBS is open. Client capture works, Window/Display capture work. | OBS forum moderator prgmitchell: "Riot hasn't updated their anti-cheat so game capture will currently not work for their games on v31." and "I would recommend window or display capture sources in the meantime". On 12-10: downgrading alone fails "because even though you have downgraded OBS the game capture hook is still updated". Community fix: `rmdir /s /q %programdata%\obs-studio-hook` and then install 30.2.3. | [OBS forum 182440](https://obsproject.com/forum/threads/obs-31-0-0-immense-lag-and-game-capture-hook-failing.182440/); [r/obs 1h8oatz](https://reddit.com/r/obs/comments/1h8oatz/) |
| 2024-12-08 | OBS 31 + Valorant (same Vanguard) | Game Capture freezes or crashes Valorant; Valorant cannot launch while OBS runs | OBS member Fenrirthviti: "Riot's anticheat services are not compatible with the new certs… we ran out of time where we could delay a release any longer. We are actively working with them to resolve this" | [obs-studio #11602](https://github.com/obsproject/obs-studio/issues/11602) |
| 2024-12-19 | Outplayed (Overwolf) | "Can't capture league of legends using outplayed"; says another app is being captured | Staff asked for a ticket; unresolved. Same window as the OBS 31 problem, but the link is not established. | [r/Overwolf 1hhx6po](https://reddit.com/r/Overwolf/comments/1hhx6po/) |
| 2025-01-16 | OBS | n/a | Fenrirthviti: "we have acquired a new certificate that should be compatible with Riot's anticheat solution… no ETA". Also: "please report any actual crashes/freezing in the games themselves to Riot." | [#11602](https://github.com/obsproject/obs-studio/issues/11602) |
| 2025-01-22 | OBS | Mechanism | Fenrirthviti: "Riot's anti-cheat has a function that checks the signature of the third-party application to see if it's trusted. That check causes a hang somewhere, and since we retry hook on failure… it causes an endless loop of validating the signature." | [#11602](https://github.com/obsproject/obs-studio/issues/11602) |
| 2025-01-19 to 2025-04-23 | OBS 31.0.x | Duplicate reports: "League of legends can't be captured as Game Capture" (#11746), "FPS in game drops to 5" (#11754), "League of Legends freezes until OBS is closed" (#11811), "Game Capture fails to hook League" (#11879), "+v31 incompatible with Vanguard" (#11991), "31.0.3 is unable to record League" (#12075) | Closed as duplicates or expected. mihawk90: "Riot needs to update their anticheat". Fenrirthviti (2025-02-18): "Riot's anticheat is not compatible with modern certificates." | [#11746](https://github.com/obsproject/obs-studio/issues/11746), [#11879](https://github.com/obsproject/obs-studio/issues/11879), [#12075](https://github.com/obsproject/obs-studio/issues/12075) |
| 2025-01-31 | OBS 31 "anti-cheat compatibility hook" | With the option on, League stutters badly; with it off, capture is black | Display Capture, or downgrade | [r/obs 1ieivpz](https://reddit.com/r/obs/comments/1ieivpz/) |
| 2025-03-09 / 2025-05-29 | OBS 31 | League drops to 1 FPS or freezes as soon as a Game Capture source targets it | Most-confirmed fix: "use window capture and change the capture method to 'Windows 10 (1903 and up)'… AND disable your game capture" (multiple users confirm). Also: downgrade to 30.2.3. | [r/obs 1j7bxar](https://reddit.com/r/obs/comments/1j7bxar/), [r/obs 1kxfibv](https://reddit.com/r/obs/comments/1kxfibv/) |
| 2025-04-23 | OBS | Scope | OBS member Warchamp7: "This ONLY affects League of Legends and is due to an incompatibility with Vanguard. We're working with Riot and Microsoft to hopefully have it fixed in our next release." (Valorant reports in #11602 suggest a broader impact.) | [#12075](https://github.com/obsproject/obs-studio/issues/12075) |
| 2025-06-03 | OBS KB | Official compatibility table | Riot Vanguard: ✅ old cert (≤30.1), ✅ dual (30.2), **❌ new-cert-only (31.0+)**, ✅ new certs (31.1+). FACEIT is the only other ❌. | [OBS KB: Capture Hook Certificate Update](https://obsproject.com/kb/capture-hook-certificate-update) |
| 2025-06-19 | OBS 31.0.x | Community workaround: copy the 31.1-beta hook files into `%PROGRAMDATA%\obs-studio-hook` | "Confirmed this works" (2025-07-01). Unofficial; MediaFire download; not recommended. | [r/obs 1lfkszh](https://reddit.com/r/obs/comments/1lfkszh/) |
| **2025-07-07** | **OBS 31.1.0** | **Fix shipped.** Release notes: "Updated game capture hook signatures on Windows… This update fixes game capture with games from Riot Games that use Vanguard" (in betas from 2025-05-29; also in 31.1.1/31.1.2) | Update OBS | [OBS 31.1.0 release](https://github.com/obsproject/obs-studio/releases/tag/31.1.0) |
| 2025-10-17 | Intel Driver & Support Assistant | After disabling it, Vanguard showed "needs to be running" 5-7 min into an ARAM and kicked the player to the client | Reboot; keep it running or uninstall it (single report, causality unclear) | [r/leagueoftechsupport 1o941op](https://reddit.com/r/LeagueofTechSupport/comments/1o941op/) |
| 2025-12-06 | RTCore64.sys (MSI Afterburner/RivaTuner, ASUS Armoury Crate) | Vanguard "incompatible software" error naming RTCore64.sys; Valorant/Riot games will not launch | Remove the driver, not just the app ("Disabling the app is not enough — the driver stays active"). A commenter (2026-01-28) moved the flagged `.sys` out of System32 and restarted. | [r/ASUS 1pfxl3d](https://reddit.com/r/ASUS/comments/1pfxl3d/) |
| 2026-01-06 to 01-08 | vgk.sys on Windows 10 | BSOD 2-3 min after opening the client; several users the same day | BIOS update (several confirmations) | [r/leagueoftechsupport 1q5xzm4](https://reddit.com/r/LeagueofTechSupport/comments/1q5xzm4/) |
| 2026-01-27 | Riot article "Error VAN: Incompatible Software" | Official guidance | Note the file path, uninstall the associated software, delete the flagged `.sys` if it cannot be uninstalled, restart, and reinstall Vanguard. It does not name any product. | [Riot Support](https://support.riotgames.com/en-us/riot/performance/error-van-incompatible-software) (date shown 2026-01-27) |
| 2026-02-20 | OBS streaming (any capture method) | Stream bitrate drops to 0 as soon as a League/Valorant match loads | Cause: the PC's "network boost mode" (flagged in the OBS log). Not Vanguard. | [r/obs 1r9pbre](https://reddit.com/r/obs/comments/1r9pbre/) |
| 2026-03-05 | OBS 32.1.0-rc4 | "Fixed an issue with the certificate used to sign Windows releases" | n/a (no Riot mention) | [OBS releases](https://github.com/obsproject/obs-studio/releases/tag/32.1.0-rc4) |
| 2026-07-09 | RGB software (Valorant) | Anecdote: "the only thing Vanguard ever messed with was my RGB software, it just killed the lighting completely mid-game"; webcam and capture card fine | n/a | [r/obs 1urr04e](https://reddit.com/r/obs/comments/1urr04e/) |
| 2026-07-17 to 07-20 | Sophos Endpoint Agent | VAN 289 at launch (LoL and Valorant) | Riot Support read the logs and suspected Sophos; uninstalling Sophos fixed it | [r/leagueoftechsupport 1uywhku](https://reddit.com/r/LeagueofTechSupport/comments/1uywhku/) |
| 2026-07-17 | Riot article "VAN: Incompatible OEM Driver" | Official list of named drivers: `iastorvd.sys` (Intel RST/VMD), `secnvme.sys`, `solidnvm.sys`, `asstahci64.sys`, `mtkwl6ex.sys` (MediaTek Wi-Fi 6E) | Update to the Intel RST driver or switch to the Microsoft inbox NVMe/AHCI driver; MediaTek ≥3.5 | [Riot Support](https://support.riotgames.com/en-us/riot/performance/van-incompatible-oem-driver) |
| **2026-07-21 to 07-22** | **OBS Game Capture (32.1.x/32.2.0)** | Black Game Capture for League (some users also Valorant) that "was working last night"; Window/Display capture fine | Fixes reported: delete files in `%programdata%\obs-studio-hook` and reopen OBS as admin; reinstall Vanguard and reboot; Window Capture with "Windows 10 (1903 and up)"; or wait ("game capture is working again", 07-22). OBS member Fenrirthviti on #13686 (2026-07-22): likely "because the hook was in use when you updated OBS… Reboot your PC, launch OBS before any other games". OBS 32.2.1 (2026-07-24) hotfix: "Fixed game capture failing after updating OBS if the previous hook was still in use". | [r/obs 1v2bav6](https://reddit.com/r/obs/comments/1v2bav6/); [obs-studio #13686](https://github.com/obsproject/obs-studio/issues/13686); [OBS 32.2.1](https://github.com/obsproject/obs-studio/releases/tag/32.2.1); [OBS forum 195861](https://obsproject.com/forum/threads/game-capture-black-screen-with-only-league-of-legends.195861/) (already in vanguard_constraints.md) |
| 2026-07-22 | Porofessor (Overwolf/standalone) | Works in champ select, does nothing in game | Overwolf staff (Hades4u): "make sure your Vanguard is updated and to restart your Pc; there was an issue with a Riot update that should now be fixed." | [r/Overwolf 1v3j2g4](https://reddit.com/r/Overwolf/comments/1v3j2g4/) |

### Official positions found
- **OBS (official):**
  - KB table: Vanguard fails only with the 31.0-era new-cert-only hook ([KB](https://obsproject.com/kb/capture-hook-certificate-update), 2025-06-03).
  - 31.1.0 release notes say the fix shipped ([release](https://github.com/obsproject/obs-studio/releases/tag/31.1.0)).
  - Staff explain the mechanism: Vanguard checks the signature of the hook it is about to accept, an untrusted signature causes a hang, and OBS's hook retry loop turns that into an endless loop ([#11602](https://github.com/obsproject/obs-studio/issues/11602), 2025-01-22).
  - Staff stance, Fenrirthviti (2025-01-25): even with a new cert, "this is *still an issue on Riot's side that could happen for any number of reasons*".
- **Riot:** I found no statement about OBS, streaming or recording software in any of these:
  - [Riot Vanguard FAQ (LoL)](https://support.riotgames.com/en-us/league-of-legends/performance/riot-vanguard-faq-league-of-legends), date shown 2026-06-02. Its only related text is "Vanguard has blocked something from loading on your machine" (tray notification) and "Vanguard will inform you what vulnerable vectors are being affected through a Windows notification."
  - [VAN error codes index](https://support.riotgames.com/en-us/riot/performance/vanguard-error-codes), date shown 2026-05-22. It lists `VAN: Incompatible Software`, `Incompatible OEM Driver`, `STATUS_SB_POLICY`, `STATUS_VMD_9001`, restriction codes and numeric codes.
  - [Incompatible Software](https://support.riotgames.com/en-us/riot/performance/error-van-incompatible-software).
  - [Incompatible OEM Driver](https://support.riotgames.com/en-us/riot/performance/van-incompatible-oem-driver).
- **OBS staff reported working "with Riot and Microsoft"** (2025-04-23), but Riot itself published nothing.

### Inferences
- **For the recorder design:**
  - Game Capture-style DLL injection into League depends on Vanguard trusting the injector's code-signing certificate. Even OBS, an EV-signed, widely used project, lost League capture for **7 months** (2024-12-07 → 2025-07-07) after changing certificates.
  - A new, small vendor's hook would not be on Vanguard's trust list at all.
  - WGC window capture / DXGI display capture was the working fallback in every incident here. That reinforces the existing rule in vanguard_constraints.md: default to WGC/DXGI and never inject.
- **Failure-mode taxonomy:**
  1. Injected capture into League: black frame, or game FPS collapses to 0-5 / freezes (OBS 31, July 2026). The game still launches. No VAN error or ban reported.
  2. Kernel drivers and security products: VAN error or "Incompatible Software/OEM Driver" at launch, or a mid-game "Vanguard needs to be running" kick. Examples: RTCore64.sys, Sophos, OEM storage/Wi-Fi drivers, old BIOS.
  3. Overlay apps: in-game features stop after Riot patches (Porofessor July 2026; Overwolf replay events May 2025). These are not bans.
- A tool that only reads port 2999 and uses WGC should be robust to (1) and (2). It should still detect a black or frozen capture at runtime (for example, mean-luma check on the first frames) and alert the user. Same-week breakages (2026-07-21/22) show that capture can silently fail after any OBS or Riot update.

### Gaps
- **Medal, ShadowPlay / NVIDIA App, AMD ReLive, Discord overlay, Steam overlay:** I found no dated League+Vanguard incident.
  - Arctic Shift title searches of r/leagueoflegends for these terms timed out or returned HTTP 422.
  - r/leagueoflegends deletes tech posts (bodies "[removed]"), so the evidence lives in r/leagueoftechsupport, r/VALORANTTechSupport, and vendor forums not covered here.
  - The one ShadowPlay title hit (2024-09-09) is a joke post.
- The 2024-05-02 "MSI Afterburner getting destroyed by vanguard" post body was removed, so whether that case was a block or a crash is unknown. The 2025-12-06 RTCore64.sys post is the concrete Afterburner/Armoury Crate evidence.
- I found no Riot statement ever acknowledging the OBS 31 incompatibility, and no Riot list of supported capture or overlay software.
- The 2026-05-21 "Vanguard crashes for Nvidia GPU" r/leagueoftechsupport post (1tlo4wc) has no body in the archive. The underlying Riot/NVIDIA notice was not located.
