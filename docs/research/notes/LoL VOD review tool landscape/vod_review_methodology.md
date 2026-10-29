# LoL VOD Review Methodology, Moment Taxonomy, Tool UX, and Timeline Metrics (as of Oct 2026)

> Research-process note for the report writer: The shared WebSearch budget for this session ran out after the first query, so these notes come from one search plus direct fetches of known URLs. Several planned sources could not be retrieved: mobalytics.gg (DNS failure and a 403), the Wayback Machine (blocked, so no Senpai.gg archive), the Oracle's Elixir definitions page (rendered empty), the Riot match-v5 OpenAPI schema (404 or truncated), and the Porofessor homepage (no post-game content). Anything not backed by a fetched page is listed under **Gaps** or marked **[unverified background knowledge]** in Inferences. Treat those items as hypotheses to check, not as findings.

## 1. Review methodology used by coaches and educators

### Takeaway
Sources agree on a small set of concrete practices:
- Review every death, on the assumption that each one is a mistake.
- At each problem moment, pause and ask "what did I know, and what should I have done?"
- Use team-only fog of war so you see only what you knew at the time.
- Pick 2-3 themes per session instead of listing every error.
- Log recurring mistakes across games in a journal or spreadsheet.
- Download replays before the patch changes, because replays expire with the patch.

Experts also say to stop on decision points, not only on deaths. That is the key design hint for an automatic ranker: review the 30-90 s window *before* a bad outcome, not the outcome itself.

### Cited Findings
- **Deaths first.** "It's safe to assume that every death you have is a misplay or a mistake." Review every death. — [Dignitas: How to analyze your VODs](https://dignitas.gg/articles/how-to-analyze-your-vods-to-improve-at-league-of-legends)
- **Early game (first 15-20 min).** The core rule is "DO NOT DIE." Check trades and missed last hits. Watch the minimap for enemy jungler movement and missed objective trades. Ask why you died. — [Dignitas](https://dignitas.gg/articles/how-to-analyze-your-vods-to-improve-at-league-of-legends)
- **Fog-of-war setting.** "Change the 'Fog of War' to your team to simulate what you can actually see in-game." — [Dignitas](https://dignitas.gg/articles/how-to-analyze-your-vods-to-improve-at-league-of-legends)
- **Late game.**
  - Check whether deaths are stopping you from contesting objectives.
  - Check vision before fights: "Make sure that you're not fighting into the dark."
  - After a won fight, check whether you turned the lead into objectives.
  - Check teamfight positioning for your role.
  - Source: [Dignitas](https://dignitas.gg/articles/how-to-analyze-your-vods-to-improve-at-league-of-legends)
- **Mechanics checks.** Missed CC setups for your jungler, and skillshots aimed into minions instead of champions. — [Dignitas](https://dignitas.gg/articles/how-to-analyze-your-vods-to-improve-at-league-of-legends)
- **Playback speed.** Fast-forward through downtime: "use the fast forward feature to go 2x, 4x, or even 8x speed!" — [Dignitas](https://dignitas.gg/articles/how-to-analyze-your-vods-to-improve-at-league-of-legends)
  - Insights.gg instead says to watch at normal speed and pause at each mistake: "If you never stopped, you didn't review." — [Insights.gg](https://insights.gg/blog/what-is-vod-review)
  - The two are compatible: skim downtime fast, play decision windows at 1x.
- **Journal.** Keep a "League Journal" spreadsheet to track results and spot repeating factors. — [Dignitas](https://dignitas.gg/articles/how-to-analyze-your-vods-to-improve-at-league-of-legends) (also summarized in search results for [Dignitas: The importance of reviewing VODs](https://dignitas.gg/articles/the-importance-of-reviewing-vods))
- **Replay expiry.** In-client replays (Match History → download) work only for the patch they were played on, so review before the replay expires. — [Dignitas: importance of reviewing VODs (via search summary)](https://dignitas.gg/articles/the-importance-of-reviewing-vods)
  - Built-in replays in League and other games expire and can't be shared as video, so record your own matches. — [Insights.gg](https://insights.gg/blog/what-is-vod-review)
- **The core question.** At each mistake, ask "What did I know at that moment, and what should I have done with it?" — [Insights.gg](https://insights.gg/blog/what-is-vod-review)
- **Look for causes, not results.** Ask whether you used key abilities too early or too late, and whether the team repeated the same positional mistake. — [Insights.gg](https://insights.gg/blog/what-is-vod-review)
- **Themes and session length.** Limit each session to 2-3 themes; "fifteen focused minutes beats an hour of passive watching." — [Insights.gg](https://insights.gg/blog/what-is-vod-review)
- **Cadence.** For solo players, review one loss per session. Short weekly sessions beat long monthly ones. — [Insights.gg](https://insights.gg/blog/what-is-vod-review)
- **Which games to review.**
  - Choose a game representative of your average performance, preferably a challenging one. — [WeCoach](https://wecoach.gg/blog/article/up-your-game-understanding-league-of-legends-vod-reviews) (search snippet only)
  - Also review some wins, because wins hide mistakes that happened to work out. — [Insights.gg](https://insights.gg/blog/what-is-vod-review)
- **Team format.**
  - One person drives the video and everyone watches the same frame.
  - Stop on decision points, not just deaths.
  - Attach comments to timestamps (e.g., "at 4:12, why is everyone stacked here?").
  - Draw on the frame.
  - Keep notes in a shared workspace.
  - Source: [Insights.gg](https://insights.gg/blog/what-is-vod-review)

### Inferences
- A tool should present each death as a *window* rather than a single point in time. By default, start 30-60 s before the death so the user sees the decision that led to it. The Dignitas and Insights.gg emphasis on "why" and "what did I know" points this way. The exact 30-60 s figure comes from the brief and community convention; no fetched source states it.
- Fog-of-war (team-only vision) playback is the right default for decision review. The tool should offer it, or at least remind the user of it, when it jumps the replay to a moment.
- Limiting review to 2-3 themes implies a ranked shortlist of about 5-10 moments, grouped by theme. A full chronological event dump would be too much.
- Including wins in review means the ranker should also surface "risky successes" in won games, such as a fight taken without vision that happened to work.

### Gaps
- Content from Coach Curtis, LS, Skill Capped, Broken by Concept, Mobalytics, and the r/summonerschool wiki could not be retrieved, because the search budget ran out and mobalytics.gg could not be fetched. Specific claims from them are unverified here:
  - checking wave state before roams and recalls
  - objective setup 60-90 s before spawn
  - CS checkpoints
  - trading death timers against objectives
- No source fetched gives a recommended number of games per day. "1-2 games a day" from the brief is not confirmed; Insights.gg says one loss per session.

## 2. Taxonomy of moments and signals for detecting and ranking them

### Takeaway
Live Client Data `/eventdata` gives only 11 coarse event types, with names and no positions:
- GameStart, MinionsSpawning, FirstBrick, TurretKilled, InhibKilled, DragonKill (with DragonType and Stolen), HeraldKill, BaronKill, ChampionKill (victim, killer, assisters), Multikill, and Ace.

`/playerlist` can also be polled for `isDead`, `respawnTimer`, `level`, `items`, and `scores`. So during a live game, a tool can detect *what* happened and *who* was involved, but not *where* or *how*. Death categories that depend on position need either match-v5 timeline positions (once per frame, plus event positions) or computer vision on the recording.

The 2026 map is different from 2025, and an objective model must reflect that:
- **V26.01 removed:** Atakhan and Feats of Strength.
- **V26.01 added:** Faelights, special ward spots.
- **V26.01 changed:** Baron moved to 20:00, general camps to 0:55, scuttle to 2:55, passive gold to 1:05, and turret plating is no longer removed at 14:00.
- **Voidgrubs** (3, at 8:00, no respawn) and **Rift Herald** (15:00) remain.

### Cited Findings
**Live Client Data API**
- **Event schema.** `/eventdata` returns `Events[]` with `EventID`, `EventName`, and `EventTime`. The full event list and fields:

  | Event | Extra fields |
  |---|---|
  | GameStart | none |
  | MinionsSpawning | none |
  | FirstBrick | KillerName |
  | TurretKilled | TurretKilled, KillerName, Assisters |
  | InhibKilled | InhibKilled, KillerName, Assisters |
  | DragonKill | DragonType, Stolen, KillerName, Assisters |
  | HeraldKill | Stolen, KillerName, Assisters |
  | BaronKill | Stolen, KillerName, Assisters |
  | ChampionKill | VictimName, KillerName, Assisters |
  | Multikill | KillerName, KillStreak |
  | Ace | Acer, AcingTeam |

  Source: [Riot sample events JSON](https://static.developer.riotgames.com/docs/lol/liveclientdata_events.json). There are no Voidgrub, Atakhan, plate, or ward events in this sample. The sample may be outdated.
- **Endpoints.** The API is served at `https://127.0.0.1:2999/liveclientdata/` with a self-signed certificate:
  - `/playerlist` gives `isDead`, `respawnTimer`, `items`, `level`, `position` (role), `scores`, and `summonerSpells`.
  - `/activeplayer` gives `championStats`, `currentGold`, and `abilities`.
  - `/gamestats` gives `gameTime`.

  Source: [Riot Developer Docs – LoL](https://developer.riotgames.com/docs/lol)
- **Replay API.** Enable it with `EnableReplayApi=1` in `game.cfg`. Endpoints at `https://127.0.0.1:2999/replay/`:
  - `/playback`: seek to a game time, pause, set speed
  - `/render`: camera and fog settings
  - `/recording`: record video to a file with a codec
  - `/sequence`: keyframed camera sequences

  League Director is Riot's example tool. Source: [Riot Developer Docs – LoL](https://developer.riotgames.com/docs/lol)

**Current map state (2026)**
- **Atakhan.** Removed from the game in V26.01. Before that (2025):
  - It spawned at 20:00 on the river side with more combat score (side decided at 14:00).
  - The Voracious and Ruinous forms were cut in V25.09, leaving only Thornbound.
  - Thornbound collected Blood Roses and gave Spirit Petals plus the Spiritual Purification buff.

  Source: [LoL Wiki – Atakhan](https://wiki.leagueoflegends.com/en-us/Atakhan)
- **Feats of Strength.** First team to 2 of 3 feats won: 3 champion kills, first turret, or 3 epic monsters (2 of 3 grubs counted). The reward was Blessing of Noxus (Triumphant tier-2 boots and tier-3 boot unlock). Added in V25.S1.1 and removed in V26.01. — [LoL Wiki – Feats of Strength](https://wiki.leagueoflegends.com/en-us/Feats_of_Strength)
- **V26.01 map and timer changes:**
  - Feats removed. Faelights added: warding one gives +25% vision radius and reveals a bonus region for 45 s.
  - Turret plating exists from game start.
  - Homeguard and Deathguard durations replaced with a turret-dependent lane endpoint, with a 14:00 breakpoint.
  - Ambient game start moved to 0:25 and passive gold to 1:05.
  - Source: [LoL Wiki – V26.01](https://wiki.leagueoflegends.com/en-us/V26.01)
- **V26.01 monster and turret changes:**
  - Baron initial spawn moved to 20:00 from 25:00.
  - Camps first spawn at 0:55; scuttle at 2:55.
  - Starting levels raised: Elder to 13, Herald to 9, Voidgrubs to 7.
  - "Turret plating is no longer removed at 14:00." Plate thresholds are now 10/25/45/70/100%.
  - Outer turrets decay between 11:00 and 15:00.
  - Atakhan "Removed from the game."
  - Source: [LoL Wiki – V26.01 (monsters/turrets section)](https://wiki.leagueoflegends.com/en-us/V26.01)
- **Voidgrubs and Herald.** Voidgrubs spawn at 8:00 (moved from 6:00 in V25.09). There are 3 in a single group, with no respawn since V25.09. They despawn at 14:45 (14:55 if in combat). Rift Herald spawns in the same pit at 15:00. — [LoL Wiki – Voidgrubs](https://wiki.leagueoflegends.com/en-us/Voidgrubs)

### Inferences
**Moment taxonomy, with the data each type needs**

LCD = Live Client Data; TL = match-v5 timeline; CV = computer vision on video.

| Moment type | How to detect it | Data source |
|---|---|---|
| Own death (highest default priority, per Dignitas) | ChampionKill where VictimName is you, or `isDead` flips | LCD |
| Solo or isolated death (caught out) | ChampionKill with 0-1 assisters; position far from allies at the last frame | Assisters: LCD. Isolation: TL positions or CV |
| Gank or dive death | Killer set includes the enemy jungler or a roaming laner; position under your own tower (needs map coordinates) | Assisters: LCD. Location: TL or CV |
| Teamfight death | Several ChampionKill events within ~10-15 s, involving at least 6 players in total | LCD |
| Death traded for an objective | Your death within about ±30 s of an enemy DragonKill, HeraldKill, BaronKill, TurretKilled, or InhibKilled | LCD |
| Death while the enemy had an objective window | Same as above, using the objective spawn calendar derived from the V26.01 timers | LCD plus a timer model |
| Death with flash down | Needs summoner cooldown state. LCD gives `summonerSpells` but no cooldown data in the docs fetched here | Probably CV only |
| Death with no vision | Needs ward positions | Not in LCD. Possibly TL ward events [unverified background knowledge], else CV |
| Death after overextending the wave | Needs minion and wave positions | Not in LCD or TL; CV only |
| Late-game death | Same ChampionKill event; weighted by stakes (see below) | LCD |

Weighting late-game deaths: `respawnTimer` from `/playerlist` lets you weight a death by the seconds of map absence it caused. Weight it higher when an objective spawns within that window. This is the "death timer vs objective" trade.

**Objective moments for the 2026 map**
- Elemental drakes and Elder (DragonKill, including DragonType and Stolen).
- Voidgrubs (8:00, once). They may not show up in LCD events; this must be verified.
- Herald (15:00).
- Baron (20:00).
- First tower (FirstBrick).
- Inhibitors.
- Aces.
- Multikills and shutdowns.
- Plates: no longer time-limited at 14:00 per V26.01, so the "plates before 14 min" heuristic from older guides is stale.

Atakhan and Feats should **not** be modeled for 2026 games. They may still appear in replays and data from 2025-era games.

**Ranking heuristic (proposed; no published approach was found)**

`score = w1·self_involvement + w2·stakes + w3·swing + w4·participants + w5·phase + w6·surprise`

Each term:
- **self_involvement:** 1.0 if you are the victim, 0.6 if you are the killer, 0.4 if you assisted, 0.1 if absent.
- **stakes:** the objective value tier, Baron/Elder > inhibitor/ace > drake/Herald > grubs > tower > kill. Multiply by the respawn-timer share, i.e., your death time divided by the time to the next objective.
- **swing:** the team gold-difference change over a 60-90 s window. Needs TL `totalGold` per frame, or LCD item value plus kills as a proxy.
- **participants:** the number of champions involved.
- **phase:** weight early deaths higher for laners, following Dignitas's "DO NOT DIE" early-game rule.
- **surprise:** repeated pattern. The same death type has been seen in recent games, per the journal advice.

Merge events within about 15 s of each other into one "moment" clip, and start the review window 30-60 s earlier.

### Gaps
- The match-v5 timeline schema could not be fetched (riotapi-schema 404 or truncated). Fields to verify before relying on them **[unverified background knowledge]**:
  - frames at a 60000 ms `frameInterval`
  - `participantFrames` with `position`, `totalGold`, `currentGold`, `xp`, `level`, `minionsKilled`, `jungleMinionsKilled`, `damageStats`, `championStats`, `timeEnemySpentControlled`
  - event types such as `CHAMPION_KILL` (with `position`, `bounty`, `shutdownBounty`, `killStreakLength`, `victimDamageDealt`/`victimDamageReceived`), `CHAMPION_SPECIAL_KILL` (first blood and multikill), `ELITE_MONSTER_KILL` (`monsterType`/`monsterSubType`, including HORDE for grubs), `BUILDING_KILL`, `TURRET_PLATE_DESTROYED`, `WARD_PLACED`/`WARD_KILL`, `ITEM_PURCHASED`, `LEVEL_UP`, `SKILL_LEVEL_UP`, and `DRAGON_SOUL_GIVEN`
- No source confirmed whether the Live Client Data API currently emits events for Voidgrubs, plates, or Faelights. The sample JSON has none.
- First drake spawn time and Herald and Dragon respawn timers under V26.01 were not confirmed. The fetched excerpt did not list them.
- No source on the "flash down" signal through any API.

## 3. UX patterns from existing review and analysis tools

### Takeaway
Little first-party UX detail could be retrieved. Mobalytics and Wayback were unreachable, and the Porofessor homepage describes only live-game lookup.

The confirmed patterns are the coaching-workflow ones:
- comments pinned to timestamps
- drawing on the frame
- a shared note space
- one person driving the shared frame

Riot's Replay API also makes "jump to moment" and auto-recorded clips technically feasible, via `/playback` seek, `/render` fog and camera, and `/recording`.

### Cited Findings
- **Insights.gg review UX:**
  - Comments attached to timestamps, e.g., "at 4:12, why is everyone stacked here?"
  - Drawing on the frame to show positioning and utility lines.
  - Notes kept in a shared workspace rather than chat.
  - Record your own footage because built-in replays expire.
  - Source: [Insights.gg](https://insights.gg/blog/what-is-vod-review)
- **Riot Replay API.** Supports seeking and pausing (`/playback`), changing render and camera properties (`/render`), recording video (`/recording`), and keyframed camera sequences (`/sequence`). League Director is the reference tool. — [Riot Developer Docs – LoL](https://developer.riotgames.com/docs/lol)
- **League replay controls.** Speeds of 2x, 4x, and 8x, plus a team fog-of-war toggle. — [Dignitas](https://dignitas.gg/articles/how-to-analyze-your-vods-to-improve-at-league-of-legends)
- **Porofessor homepage.** Covers only live-game and lobby lookup, using the last 30 days of normal and ranked stats. Post-game features are not described there. — [Porofessor](https://porofessor.gg/)

### Inferences
Patterns that follow from the sources:
- **Timeline scrubber with typed event markers:** kills, deaths, objectives, towers.
- **Per-moment card:** shows the question "What did I know? What should I have done?" with a note field.
- **"Open in replay" button:** seeks the client through the Replay API to T-45 s, with team fog on.
- **Theme tags:** aggregated across games into a recurring-mistake journal.

Unconfirmed in this session:
- Gold-diff graphs and minimap replays are standard on stat sites **[unverified background knowledge]**.
- Mobalytics GPI and Blitz post-game screens were not fetched.

### Gaps
- No retrieved details on any of these:
  - Mobalytics GPI and its post-game timeline
  - Blitz post-game
  - Senpai.gg mistake surfacing (Wayback blocked)
  - League's death recap
  - LoL Esports broadcast key moments
  - Medal or Outplayed clip lists
  - Shadow.gg or Bayes pro tools

  These need a follow-up pass once search budget returns.

## 4. Metrics and derived insights from match timeline data

### Takeaway
No metric-definition page could be retrieved: Oracle's Elixir rendered empty and Mobalytics was unreachable. The only confirmed data is the set of raw fields the live API exposes:
- per-player `scores` (kills, deaths, assists, creepScore, wardScore)
- `level`, `items`, `currentGold` (active player only), `respawnTimer`, and `gameTime`

From those, a tool can derive several standard coaching metrics live:
- CS at time checkpoints
- KP
- deaths before 15
- ward score per minute

Gold diff and damage share need match-v5 data.

### Cited Findings
- **`/playerscores` fields:** `kills`, `deaths`, `assists`, `creepScore`, `wardScore`. `/playerlist` adds `items`, `level`, and `respawnTimer`. `/activeplayer` adds `currentGold` and `championStats`. `/gamestats` adds `gameTime`. — [Riot Developer Docs – LoL](https://developer.riotgames.com/docs/lol)
- **Early-game emphasis.** Dignitas focuses on the first 15-20 minutes: last hits, trades, and deaths. This supports a lane-phase (0-14/15 min) versus mid/late split. — [Dignitas](https://dignitas.gg/articles/how-to-analyze-your-vods-to-improve-at-league-of-legends)

### Inferences
Metrics a tool can compute, by data source:
- **Live API (polled):** CS@10/15, CS per minute, KP = (K+A) / team kills, deaths before 14:00 or 15:00, wardScore per minute, and level difference against the lane opponent at checkpoints.
- **match-v5 timeline [unverified background knowledge]:** gold diff and XP diff at 10/15, damage share, and gold share.

Use 14:00 as the lane-phase boundary for 2026, since the V26.01 Homeguard and endpoint breakpoint is at 14:00 ([LoL Wiki – V26.01](https://wiki.leagueoflegends.com/en-us/V26.01)).

### Gaps
- Exact Oracle's Elixir or Mobalytics definitions were not retrieved: GD@15, CSD@10, XPD, DPM, DMG%, VSPM, WPM, WCPM, EGPM, and earned-gold share. These need a follow-up fetch.
- No published moment-ranking or "key moment" scoring approach from any vendor was found in this session.
