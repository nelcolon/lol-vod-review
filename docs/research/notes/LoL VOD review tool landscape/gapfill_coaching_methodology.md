# Gap-fill: Coaching VOD-Review Methodology, Death Taxonomy, Post-Game Tool UX, Key-Moment Scoring, and Metric Definitions (fetched 2026-10-29)

> Research-process note for the report writer:
> - WebSearch was unavailable. Everything here comes from direct fetches (WebFetch or curl) on 2026-10-29. Wayback Machine snapshots worked through curl; the snapshot date is given with each one.
> - **Unreachable this pass:**
>   - reddit.com and old.reddit.com (WebFetch refuses the domain; curl gets a login redirect or 403), so there is **no r/summonerschool content**.
>   - Live mobalytics.gg (403).
>   - skill-capped.com (JS-only app shell).
>   - coachcurtis.net (no DNS).
>   - bayesesports.com (no DNS).
>   - The Oracle's Elixir definitions table (loaded from an API that returned 403).
>   - Search engines: DuckDuckGo and Bing returned nothing usable.
> - brokenbyconcept.com now redirects to **weteachleague.com**, the coaching brand of the Broken by Concept podcast. Its blog was fetched.
> - **Already covered in `vod_review_methodology.md`, not repeated here:** the Dignitas and Insights.gg advice, the V26.01 map and timer changes, the Live Client Data event list, and the proposed ranking formula.
> - Items marked **[unverified]** come from my own background knowledge and should be checked.

## 1. Step-by-step review checklists coaches recommend

### Takeaway
New sources add these concrete steps to the Dignitas and Insights.gg advice:
- **Mobalytics (2016/2019):**
  - Jump the replay to 1:40.
  - Watch minutes 0-12 and log every skill use, good and bad.
  - Start with deaths, assuming each one is a mistake.
  - Tag each mistake with one of six categories (positioning, decision-making, skill usage, vision, cooldowns, map awareness).
  - Also review teamfights and skirmishes that ended with no kills.
  - Keep a spreadsheet journal with laning, KDA-event, and notes tabs.
- **We Teach League (Broken by Concept):** practise *one* skill per game, review only that skill for 5-10 minutes per game, and play 3-5 games a day.

No fetched coaching source gives a "rewind 30-90 s before the death" number. That window is still a convention, not a cited rule.

### Cited Findings
**Mobalytics, "How & Why to Watch Your League of Legends Replays"**
Published 2016-09-15, modified 2019-02-19; Wayback snapshot 2019-08-21. [Mobalytics via Wayback](https://web.archive.org/web/20190821173012/https://mobalytics.gg/blog/watch-league-of-legends-replays/)
- **Start point.** "When the replay opens, jump to 1:40 on the timeline as this is typically when laning begins. Watch through the first 10 to 12 minutes of each game and make a note each time you use a skill, especially focusing on the good uses and bad uses."
- **Deaths first.** "It's good to assume that every death is a mistake… Personally I like to start with the deaths." It also allows for intentional sacrifices by engage champions ("sacrificial lamb").
- **Six mistake categories:**

  | Category | Examples given |
  |---|---|
  | Positioning | too far forward, too far back, not taking the enemy comp into account |
  | Decision-making | bad time to contest Dragon or to split push |
  | Skill usage | not prioritising targets, rushed ult |
  | Vision | not helping the support ward, chasing into fog of war |
  | Cooldowns | engaging with skills down, not using summoners when they are up |
  | Map awareness | ganked while all enemies were missing and you were deep in lane |

- **Fights without kills.** "It's ideal to look at all team fights, not just the ones that give the KDA's… if there's a skirmish with no kills or deaths, maybe if your positioning was better you could have secured one or more kills."
- **Camera control.** Check for "unnecessary positioning and re-positioning of the camera during fights."
- **Journal.** Google Sheet with tabs for:
  - laning phase: a column per skill and per summoner spell
  - kills, deaths and assists, each in its own columns
  - general notes

  It also says to record what you did right. Deeper reviews can add early, mid and late-game tabs.

**Mobalytics, "5 Tips to Reduce Your Death Risk in League of Legends"**
Published 2021-04-23; Wayback snapshot 2021-05-13. [Mobalytics via Wayback](https://web.archive.org/web/20210513175611/https://mobalytics.gg/blog/lol-5-tips-death-risk/)
- **Questions to ask about each death:**
  - "do you die while overextending? Do you die in 1v1 fights? Or do you get constantly caught out of position?"
  - Did you check the minimap for the enemy jungler before starting a fight?
  - Did you fight into an enemy level-2 or level-6 power spike?
  - Late game: did you ward a major objective alone without knowing where the enemy was?
- **Wave check.** Pushing puts you "in an overextended position." Keep the wave near your tower, which takes "up to 3 additional enemy minions."
- **Expected deaths vary by champion.**
  - Utility supports (Soraka, Yuumi, Janna) should die rarely.
  - Frontline tanks (Malphite, Mundo) "theoretically" die more.

**We Teach League (Broken by Concept coaching brand)**
- **"How to Get Better at League of Legends."** Published 2026-09-17, modified 2026-10-16. [We Teach League](https://weteachleague.com/blog/how-to-get-better-at-league-of-legends/)
  - Example process: "I will play 3-5 games every day. I will work on one skill at a time. I will review this specific skill after every game I play."
  - Worked example: review how you used Ahri's R after every Ahri game.
  - Reviewing yourself is enough: "If you set aside five to ten minutes to review one or two games every day, you're good to go."
  - The review is detective work: "Did I die here because I lost Flash three minutes ago? Why did I lose my Flash in the first place?" This is a direct coaching example of tracing a death back to a cause minutes earlier.
- **"How to Practice League of Legends With Limited Time."** Published 2026-10-25, modified 2026-10-26. [We Teach League](https://weteachleague.com/blog/how-to-practice-league-of-legends/)
  - "Set aside around five to ten minutes per game to review key moments related to your current learning objective."
  - "You won't get more value out of reviewing hours of gameplay."
  - "Around 15 games per week is actually a great amount." The author played 15-21 games per week.
  - Recording your own gameplay "can really help improve the quality of your reviews," because a coach "usually wants to see your perspective, clicks and in-game camera usage." Suggested recorders: Ascent, Insights, OBS.
  - The page links Broken by Concept podcast segments: "Reviewing is a skill" (youtube.com/watch?v=Hqk2VbQLErA&t=4210s) and "People are scared to watch their own gameplay" (youtube.com/watch?v=LoULUyxbff0&t=3440s). These were not transcribed.
- **"HOW TO REVIEW YOUR GAMES" page.** Published 2026-03-29. [We Teach League](https://weteachleague.com/how-to-review/) The page has no text content; it is probably video or a lead-capture page.

**Replay tooling facts**
- Replays are downloaded from match history and stay available until the next patch. You can record parts of a game and export them as .webm. — [LoL Wiki – Replay](https://wiki.leagueoflegends.com/en-us/Replay) (stub, last edited 2020-02-18)
- **Death Recap** is a built-in signal for "how did I die." While you are dead it shows:
  - combat time since entering combat
  - total damage received (as a pie chart)
  - crowd control applied and received
  - up to 5 enemies, ordered by damage dealt, each split into physical, magic and true damage, with the ultimates and summoners you saw them cast
  - gold the enemy earned from the takedown
  - a Damage view per ability

  Visuals changed in V25.17. — [LoL Wiki – Death recap](https://wiki.leagueoflegends.com/en-us/Death_recap)

### Inferences
**A composite checklist the tool can encode, built from the cited items above:**
1. Laning (from 1:40 to about 12:00): skill and summoner usage log.
2. Every death: tag the cause with one of the six Mobalytics categories, then answer:
   - Was the enemy jungler visible on the minimap?
   - Was the wave pushed past the middle of the lane?
   - Was the enemy at a level-2 or level-6 spike?
   - Were key cooldowns or Flash down? Trace back to when Flash was used.
   - Late game: were you warding alone near an objective?
3. Fights with no kills.
4. Things you did well.
5. Optionally, one focus skill per game.

**Design hints**
- The "Flash three minutes ago" example implies the look-back window for a death can be minutes long, not seconds. A tool should link each death to the last time Flash was used, as well as to a 30-90 s pre-window.
- One skill per game, 5-10 minutes of review: the ranked shortlist should be filterable by the user's chosen focus skill, for example "only my R usages" or "only deaths in lane."

### Gaps
- r/summonerschool wiki and threads: unreachable (reddit blocks WebFetch and anonymous curl). No community checklist was retrieved.
- Skill Capped and Coach Curtis: unreachable. No retrieved source states the following, so they remain uncited conventions:
  - playback speed beyond Dignitas's 2x/4x/8x
  - recall-timing checks
  - objective setup 60-90 s before spawn
  - the 30-90 s pre-death window

## 2. Death taxonomy and the data signal that could detect each category

### Takeaway
Coaching sources name these death types:
- overextended (wave or position)
- lost a 1v1 or trade
- caught out of position or picked off
- ganked with the jungler unseen
- fought into an enemy power spike
- warded alone late
- dived into, or fought with cooldowns down
- "meaningless death" versus "glorious sacrifice" (Mobalytics GPI Toughness › Discernment)

The match-v5 timeline makes far more of these detectable than the Live Client API:
- `CHAMPION_KILL` carries `position`, `killerId`, `assistingParticipantIds`, `bounty`, `shutdownBounty`, `killStreakLength`.
- It also carries per-ability damage arrays: `victimDamageReceived`/`victimDamageDealt` and `victimTeamfightDamageReceived`/`victimTeamfightDamageDealt`, with `spellSlot`, `spellName`, `basic`, and damage by type.
- Per-minute `participantFrames` give `position`, gold, xp, CS, and `timeEnemySpentControlled`.

### Cited Findings
**Coaching taxonomy sources**
- Death circumstances: overextending, 1v1 fights, caught out of position. Plus: jungler not checked on the minimap, enemy level-2/6 power spike, warding objectives alone late, pushed wave. — [Mobalytics 2021 via Wayback](https://web.archive.org/web/20210513175611/https://mobalytics.gg/blog/lol-5-tips-death-risk/)
- Mistake categories: positioning, decision-making, skill usage, vision, cooldowns, map awareness. The map-awareness example: ganked "when all enemies were missing on the map and you're deep on their lane." — [Mobalytics 2016/2019 via Wayback](https://web.archive.org/web/20190821173012/https://mobalytics.gg/blog/watch-league-of-legends-replays/)
- **GPI Toughness sub-skills** (Wayback snapshot 2024-12-01). [Mobalytics GPI via Wayback](https://web.archive.org/web/20241201175129/https://mobalytics.gg/gpi/)

  | Sub-skill | Definition |
  |---|---|
  | Lane Defense | "how well you protect your tower and your ability to not get bullied if behind" |
  | **Discernment** | "how often you make a glorious sacrifice for the team versus how often you die meaninglessly" |
  | Defensive Build | (definition not quoted) |
  | Damage Taken | (definition not quoted) |
  | Deaths | average deaths per match and death share |
  | **Gank Susceptibility** | "how vulnerable you are when a wild summoner appears" |

- Death Recap data while you are dead: damage by enemy and type, combat duration, CC received, enemy ultimates and summoners seen. — [LoL Wiki – Death recap](https://wiki.leagueoflegends.com/en-us/Death_recap)

**match-v5 timeline schema**
Source: [riotapi-schema OpenAPI](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json), fetched 2026-10-29.
- **`EventsTimeLineDto` fields:**
  - `timestamp`, `realTimestamp`, `type`, `position{x,y}`
  - `killerId`, `victimId`, `assistingParticipantIds`, `killType`, `multiKillLength`, `killStreakLength`, `bounty`, `shutdownBounty`
  - `victimDamageDealt[]`, `victimDamageReceived[]`, `victimTeamfightDamageDealt[]`, `victimTeamfightDamageReceived[]`
  - `monsterType`, `monsterSubType`, `buildingType`, `towerType`, `laneType`, `killerTeamId`, `teamId`
  - `wardType`, `creatorId`, `itemId`, `beforeId`/`afterId`, `goldGain`, `level`, `levelUpType`, `skillSlot`
  - `transformType`, `featType`, `featValue`, `actualStartTime`, `winningTeam`, `name`
- **`MatchTimelineVictimDamage` fields:** `basic`, `magicDamage`, `physicalDamage`, `trueDamage`, `name`, `participantId`, `spellName`, `spellSlot`, `type`.
- **`ParticipantFrameDto` fields:** `championStats`, `currentGold`, `damageStats` (total, physical, magic and true damage, each done, done to champions, and taken), `goldPerSecond`, `jungleMinionsKilled`, `level`, `minionsKilled`, `position`, `timeEnemySpentControlled`, `totalGold`, `xp`.
- **`InfoTimeLineDto` fields:** `endOfGameResult`, `frameInterval`, `gameId`, `participants`, `frames`.

**Event `type` values**
The R4J Java client enum is a community dump; the schema does not enumerate them. File last committed 2025-02-20. [R4J EventType.java](https://github.com/stelar7/R4J/blob/master/src/main/java/no/stelar7/api/r4j/basic/constants/types/lol/EventType.java)
- CHAMPION_KILL, CHAMPION_SPECIAL_KILL, CHAMPION_TRANSFORM
- ELITE_MONSTER_KILL, BUILDING_KILL, TURRET_PLATE_DESTROYED, DRAGON_SOUL_GIVEN
- WARD_PLACED, WARD_KILL
- ITEM_PURCHASED, ITEM_SOLD, ITEM_DESTROYED, ITEM_UNDO
- SKILL_LEVEL_UP, LEVEL_UP
- OBJECTIVE_BOUNTY_PRESTART, OBJECTIVE_BOUNTY_FINISH, FEAT_UPDATE
- PAUSE_START, PAUSE_END, GAME_END
- Mode-specific: ASCENDED_EVENT, CAPTURE_POINT, PORO_KING_SUMMON

**Riot post-game `challenges` fields useful for death and fight context**
Present in match-v5 `ChallengesDto`, which has 147 fields in total; the names are self-describing, and the spec gives no definitions. — [riotapi-schema](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json)
- `killsUnderOwnTurret`, `killsNearEnemyTurret`
- `soloKills`, `quickSoloKills`, `pickKillWithAlly`
- `saveAllyFromDeath`, `killedChampTookFullTeamDamageSurvived`
- `deathsByEnemyChamps`
- `takedownsAfterGainingLevelAdvantage`
- `epicMonsterKillsNearEnemyJungler`

### Inferences
**Detection table**

TL = match-v5 timeline (post-game); LCD = Live Client Data; CV = computer vision on the recording.

| Death type (coach term) | Detection signal | Source |
|---|---|---|
| Solo / 1v1 loss | CHAMPION_KILL with an empty `assistingParticipantIds` and the killer is the lane opponent; `victimDamageReceived` contains only one champion | TL (assister count also in LCD) |
| Ganked (jungler unseen) | Killer or assisters include the enemy jungler; victim position in their own lane. Unseen-ness needs fog state | TL; fog → CV |
| Overextended | Victim `position` past the river or lane midpoint, toward the enemy turret, at the death frame. Wave state needs minion positions | TL; wave → CV |
| Dived / under own tower | Victim position inside own-turret radius; killer team includes 2+ | TL (+ map turret coordinates) |
| Caught out / picked | Victim far from all allies at the death event: distance from `participantFrames` positions, interpolated, since frames are one per `frameInterval` | TL (coarse) or CV |
| Warded alone late | Death after ~20 min near the Baron or Dragon pit with 0 allies nearby; a WARD_PLACED by the victim shortly before | TL |
| Power-spike death | The killer's `level` was higher, or the killer had just hit level 2/6 (LEVEL_UP events) | TL / LCD level |
| Cooldowns down / no ult | `victimDamageDealt` has no `spellSlot` 3 (R) entry. Flash has no damage, so its cooldown is not observable | TL partial; Flash → CV |
| Teamfight death | `victimTeamfightDamage*` arrays non-empty and/or kill clusters | TL / LCD |
| "Glorious sacrifice" vs "meaningless" | Ally kills or objective (ELITE_MONSTER_KILL, BUILDING_KILL) gained within ~30 s after the death means sacrifice; otherwise meaningless | TL / LCD |
| Shutdown given | `shutdownBounty` > 0 on CHAMPION_KILL | TL |

Thresholds such as "~20 min" and "~30 s" are my proposals, not sourced.

`frameInterval` is typically 60000 ms **[unverified]**. Frame positions are therefore once per minute, too coarse for "isolated at death." The CHAMPION_KILL `position` is exact; ally positions at that moment are not. That is the strongest argument for adding CV minimap tracking from the recording.

### Gaps
- No fetched coach source gives a formal named death taxonomy (for example "greed death / info death / mechanical death"). The taxonomy above combines Mobalytics categories with GPI sub-skills.
- Whether `WARD_PLACED`/`WARD_KILL` events carry `position` was not verified. The DTO has a `position` field, but which event types populate it is not stated.
- The fetched sample does not confirm whether `victimDamageReceived` covers the full death-recap window.

## 3. Highest-value objective and tempo moments

### Takeaway
Little coach-written material on objective value could be retrieved. Quantitative sources were found:
- **Oracle's Elixir Early-Game Rating** models the win probability at 15:00 from gold difference, map side, and elemental drake differences by type. So gold and drakes at 15:00 are the canonical early-state summary.
- **A 2026-10-24 arXiv paper** on pro objective setups found:
  - teams that are behind leave the pit empty far more often than teams that are ahead
  - teams "price fights, travel and committed players, not the objective itself"

  This supports scoring the *setup and fight* around an objective rather than the objective kill.

### Cited Findings
- **Oracle's Elixir Early-Game Win Probability Calculator:**
  - "select a split, choose your map side, and enter the gold difference and elemental drake differences as of the 15:00 mark of the game."
  - Defines "Early-Game Rating: Percentage probability of team winning as of 15:00."
  - The bundled code computes a logistic m/(1+m) over per-split coefficients for gold and side plus a difference term per drake type (infernal, mountain, ocean, cloud, plus chemtech and hextech after 2021).

  Source: [Oracle's Elixir site bundle main.9ef7a6a4.js, fetched 2026-10-29](https://oracleselixir.com/static/js/main.9ef7a6a4.js); model write-up linked as /blog/post/10689/early-game-rating-2-0 (not fetched).
- **Allocation Before the Clock** (Gao et al., arXiv 2610.33626, 2026-10-24). [arXiv](http://arxiv.org/abs/2610.33626v1)
  - "Before every neutral objective … each team decides which of its five players walk to the pit, which hold a lane, and when to commit."
  - Data: 164 MSI and Worlds 2025 games, 2,994 team setups.
  - Trailing teams leave the pit empty more often by "+34.8 percentage points at the first baron and +30.4 percentage points at Atakhan."
  - "Teams price fights, travel and committed players, not the objective itself (weight 0.018)."
  - It releases tracks, setups and code.
  - The data is from 2025 and includes Atakhan, which was removed in V26.01.
- **Coaching objective advice:**
  - Dying late stops you contesting objectives. Don't ward Baron alone when the enemy is likely there; take roundabout routes. — [Mobalytics 2021](https://web.archive.org/web/20210513175611/https://mobalytics.gg/blog/lol-5-tips-death-risk/)
  - Decision-making mistakes include "bad time to go for or contest Dragons, bad time to split push." — [Mobalytics 2016/2019](https://web.archive.org/web/20190821173012/https://mobalytics.gg/blog/watch-league-of-legends-replays/)
- **Riot tracks these as notable in post-game `challenges`:**
  - `epicMonsterKillsWithin30SecondsOfSpawn`, `epicMonsterSteals`, `epicMonsterStolenWithoutSmite`
  - `turretPlatesTaken`, `kTurretsDestroyedBeforePlatesFall`, `firstTurretKilled`, `firstTurretKilledTime`, `quickFirstTurret`
  - `acesBefore15Minutes`, `shortestTimeToAceFromFirstTakedown`
  - `baronBuffGoldAdvantageOverThreshold`, `elderDragonKillsWithOpposingSoul`, `perfectDragonSoulsTaken`
  - `turretsTakenWithRiftHerald`, `multiTurretRiftHeraldCount`

  Source: [riotapi-schema](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json)
- **Recall moments.** A community model measured the "median win-probability change across a recall [as] −0.02pp" over 63,265 recalls. A large negative swing next to a recall "is the teamfight sharing its window, not the back." — [Kreytorn/lolcoach README](https://github.com/Kreytorn/lolcoach) (repo updated 2026-08-02; community project, not peer-reviewed)

### Inferences
- **Objective stake ordering.** Rank objectives by Elder/Baron, then soul-point drake, then first tower, then other drakes, Herald and grubs. Riot's challenge names single out Elder vs opposing soul, Baron gold advantage, perfect soul, and first tower, which supports this order. The exact weights are unsourced.
- **Score the window, not the kill.** Score the 60-90 s before spawn: who was at the pit, deaths, and lanes left unpushed. The arXiv finding says the fight and commitment decide value, not the objective itself.
- **Recalls.** Do not flag recalls as key moments on their own. Flag them only when tied to a death or objective inside their window (per lolcoach).

### Gaps
- No coach-written statement was retrieved on any of these:
  - plates' value now that plating persists past 14:00 (V26.01)
  - shutdown value
  - death-timer vs objective trades

  These remain hypotheses.

## 4. How existing products present post-game review (including Senpai.gg)

### Takeaway
**Senpai.gg changed over time:**
- **2019:** an "AI Coach" that analysed playstyle and served "AI-generated video clips from professional matches" tailored to your weaknesses.
- **2021:** an all-in-one desktop assistant (builds, counters, tier lists).
- **Dec 2022:** a desktop postgame screen with four panels:
  - **Performance Stats** compared with the enemy team
  - **Strengths & Weaknesses** with recommendations
  - **Match Summary** of important in-game events
  - **Road to Victory**: "what could have been done to improve the chances of winning"

**Mobalytics GPI** scores 8 skills from 0 to 100, from Bronze-like to Challenger-like, each with sub-skills. It produces written advice through condition and trigger rules.

**Blitz** markets "Post-Match Analysis" and a real-time "Benchmarking Overlay."

### Cited Findings
**Senpai.gg (Wayback snapshots)**
- **2019-12-16:**
  - "SenpAI utilizes state-of-the-art AI methods to run a deep analysis of users' playing style, pinpointing their strengths and weaknesses."
  - "Users gain access to a personalized library of AI-generated video clips from professional matches, all tailored to their interest."
  - Mentions "computer vision technologies."

  Source: [Senpai via Wayback 2019](https://web.archive.org/web/20191216015830/https://senpai.gg/)
- **2021-01-07:** auto build import from pros, counter-pick suggestions, team and enemy analyses, tier lists. Claims to be Riot-API compliant. — [Senpai via Wayback 2021](https://web.archive.org/web/20210107084138/https://senpai.gg/)
- **2022-12-02 postgame page:**
  - "Postgame Analysis automatically shows up when a match has ended."
  - Panels: PERFORMANCE STATS ("Compare your performance on key metrics with the enemy team"), STRENGTHS & WEAKNESSES ("with recommendations right after the game ends"), MATCH SUMMARY ("important in-game events with overall team performances"), and ROAD TO VICTORY ("what could have been done to improve the chances of winning").

  Source: [Senpai post-game via Wayback](https://web.archive.org/web/20221202080509/https://senpai.gg/lol/post-game)
- **2022-12-02 in-game assistant page:** Pregame (pro items, runes and spells), Overlay, and Postgame ("post-game statistics for ally and enemy teams"). — [Senpai IGA via Wayback](https://web.archive.org/web/20221202080248/https://senpai.gg/lol/in-game-assistant)

**Mobalytics GPI** (Wayback snapshot 2024-12-01). [Mobalytics GPI via Wayback](https://web.archive.org/web/20241201175129/https://mobalytics.gg/gpi/)
- Scale: "Our GPI scores eight critical areas of your play on a scale from 0 to 100… the closer you are to zero the more like a Bronze player… 100 … like the best Challenger players."
- Skills and sub-skills:

  | Skill | Sub-skills |
  |---|---|
  | Fighting | Duels, Picks, Skirmishes (2v2-2v5), Teamfights (3+ each side), Stat Contribution |
  | Farming | General Income, Farm Efficiency (CS "when you are actually farming… not dead or in base"), Early (first 15 min) / Mid (15-30) / Late (30+) CS, gold and XP per minute |
  | Vision | Placement, Denial, Efficiency, Vision Impact |
  | Aggression | Kill Participation, Ganking (kills or assists on non-lane opponents in the first 15 min), Solo Play, Initiative, Forward Kills, Snowballing |
  | Toughness | see Section 2 |
  | Teamplay | Ward Participation, Assist Participation, Team Fight Participation, Objective Play, Utility, Kill Stealing |
  | Consistency | Laning, Performance, Comeback, Throwing ("aptitude at throwing games when you are significantly ahead"), Tilt |

- **How GPI advice is generated** ("How Mobalytics GPI Advice is Created", published 2017-08-25; Wayback snapshot 2021-10-27). [Mobalytics via Wayback](https://web.archive.org/web/20211027185636/https://mobalytics.gg/blog/how-mobalytics-gpi-advice-is-created-and-given-to-you/)
  - Hierarchy: skills, then metrics, then attributes. For example, Vision is built from Wards Placed, Cleared and Bought; Wards Bought from early and late purchases and per minute.
  - "Conditions and triggers" choose the advice, e.g. "Are you getting ganked often? Are you dying to these ganks?"
  - Advice text is written with Challenger coaches and can be voiced in different "sensei" tones, e.g. tough-love.
  - The page says communication and shot-calling "cannot be measured by current technologies."

**Blitz** (lol landing page, fetched 2026-10-29). [Blitz](https://blitz.gg/lol)
- "Post-Match Analysis – Blitz analyzes your match to give you key insights that will level up your game."
- "Benchmarking Overlay – Track key performance metrics to better guage performance in real time."
- Also "Item Value Difference Overlay" and match history.

**Community tool: Kreytorn/lolcoach** (updated 2026-08-02). [GitHub](https://github.com/Kreytorn/lolcoach)
- Terminal tool.
- "GAME REVIEW – win-probability curve with the largest swings annotated – labelled *what happened*, not *what you did wrong*."
- Percentile performance against a (champion, role, tier) cohort.
- Position-density map.
- "Habits": propensity deviation compared with your rank from the same states.

### Inferences
- **Senpai's "Road to Victory"** is the closest published precedent for a "what would have raised win chance" moment list. The 2022 marketing page does not show how it was computed.
- **Two presentation patterns recur:**
  1. A **skill-radar score** with advice: GPI, and Senpai's strengths and weaknesses.
  2. An **event-annotated timeline or summary**: Senpai's Match Summary, lolcoach's win-probability curve with swings.

  A moment-ranking tool fits pattern 2. It can borrow GPI-style triggers, such as "ganked and died repeatedly," as cross-game themes.

### Gaps
- No Senpai.gg shutdown date or announcement was found; the 2022-12 snapshot is the latest fetched.
- No screenshots were retrieved of Senpai's Road to Victory or Match Summary.
- Blitz's post-match screens were not retrieved; only the marketing line was. The same applies to Mobalytics' current post-game "game analysis" timeline.
- Porofessor, Medal, Outplayed, Shadow.gg: not covered in this pass.

## 5. Published or community scoring for "key moments"

### Takeaway
- **Win-probability added (WPA) per event** is the main community approach, used by lolcoach to annotate the largest swings. Its own author warns that it is descriptive, not causal: recalls show about 0 WPA even when they sit next to big swings.
- **Oracle's Elixir publishes a logistic early-game win-probability model** from gold difference, side and drake differences at 15:00.
- **Broadcast-style highlight detection** has used CNNs on game visual effects: Yahoo Esports 2016, average precision up to 83.18%, 18 FPS on CPU.
- **Pro objective setups** have been priced in win probability (arXiv 2026).

No published "key moment score" from Riot, LoL Esports, or Bayes was retrieved.

### Cited Findings
- **lolcoach separates three quantities that "never share a column":**
  1. `wpa_descriptive`, "a change in modelled belief. Describes."
  2. `ate_adjusted`, "an adjusted causal estimate with controls. Explains."
  3. The policy counterfactual, "what a stronger rank does in the same state. The only thing here that can support 'you should have done X'."

  Trained on 133,544 ranked games. — [Kreytorn/lolcoach](https://github.com/Kreytorn/lolcoach)
- **Oracle's Elixir EGR:** a team's win probability at 15:00 from gold difference, map side, and per-type elemental drake differences. The logistic form is visible in the site code. Other bundle definitions: "GSPD: Gold Spent Percentage Difference (margin of victory/defeat)", and an MLR (mid/late rating) column alongside EGR. — [Oracle's Elixir bundle](https://oracleselixir.com/static/js/main.9ef7a6a4.js)
- **"Real-Time Video Highlights for Yahoo Esports"** (Yale Song, arXiv 1611.08780, 2016-11-27):
  - "Most video games use pronounced visual effects to emphasize highlight moments; we use CNNs to learn convolution filters of those visual effects."
  - Covered LoL, Dota 2 and HotS; "average precision of up to 83.18%," 18 FPS on a single CPU.
  - Deployed on Yahoo Esports.

  Source: [arXiv](http://arxiv.org/abs/1611.08780v1)
- **HASSE-QRE** prices objective-setup commitment "as a quantal response equilibrium priced in win probability." — [arXiv 2610.33626](http://arxiv.org/abs/2610.33626v1)
- **GPI "Discernment"** scores deaths as "glorious sacrifice" vs "die meaninglessly." This is a product-level notion of a death's value. — [Mobalytics GPI](https://web.archive.org/web/20241201175129/https://mobalytics.gg/gpi/)

### Inferences
- Use a timeline-trained win-probability model and take `|ΔWP|` across each merged moment window as the "swing" term in the existing ranking formula. Add the lolcoach caveat in the UI: "large swing" means "what happened," not "your fault."
- To attribute blame, combine the swing with self-involvement: victim, killer, assister, or absent while the team fought. GPI-style Discernment can label a death a sacrifice if the team gained during the respawn window.
- CV highlight detection on game visual effects (the Yahoo approach) is a viable fallback for recordings with no Riot timeline, such as replays whose match ID is unavailable.

### Gaps
- LoL Esports broadcast win-probability graphics (reportedly AWS-powered **[unverified]**) could not be retrieved; the AWS and Bayes pages were unreachable.
- Riot has published nothing on "key moments."
- The Oracle's Elixir EGR 2.0 write-up was not fetched, so the coefficient values and accuracy are unknown.

## 6. Standard coaching metrics and definitions

### Takeaway
- **Oracle's Elixir metric codes** (from the site code): GP, W%, K, D, A, KDA, KP, DTH%, KD, FB%, GD10, XPD10, CSD10, GD15, XPD15, CSD15, CSPM, CS%P15, DPM, DMG%, GOLD%, WPM, WCPM, CWPM, AGT, CKPM, GPR, GSPD, EGR, MLR, FT%, F3T%, PPG, HLD%, FD%, DRG%, ELD%, FBN%, BN%, STL, STLPG, LNE%, JNG%, CTR%.
- **How OE averages:** per-game values are averaged across games, not summed totals.
- **Riot's own post-game `challenges`** provide ready-made coaching metrics. Examples: `killParticipation`, `damagePerMinute`, `goldPerMinute`, `visionScorePerMinute`, `teamDamagePercentage`, `laneMinionsFirst10Minutes`, `maxCsAdvantageOnLaneOpponent`, `laningPhaseGoldExpAdvantage`, `visionScoreAdvantageLaneOpponent`, `controlWardTimeCoverageInRiverOrEnemyHalf`.

### Cited Findings
- **OE column list.** In the site code, "XPD" is spelled "XDP10"/"XDP15". — [Oracle's Elixir bundle](https://oracleselixir.com/static/js/main.9ef7a6a4.js)
- **OE note on averages:** "values are calculated for each individual game, then averaged across games. This is true for the 'share' and 'per minute' numbers for damage to champions, earned gold, wards placed/cleared, CKPM, and so on." LCS broadcasts historically used totals, e.g. DMG% from summed games. — [Oracle's Elixir bundle](https://oracleselixir.com/static/js/main.9ef7a6a4.js)
- **OE verified definitions:** "Early-Game Rating: Percentage probability of team winning as of 15:00." "GSPD: Gold Spent Percentage Difference (margin of victory/defeat)." — [Oracle's Elixir bundle](https://oracleselixir.com/static/js/main.9ef7a6a4.js)
- **Riot match-v5 fields** — [riotapi-schema](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json)
  - **`ParticipantDto`:** `visionScore`, `wardsPlaced`, `wardsKilled`, `detectorWardsPlaced`, `visionWardsBoughtInGame`, `firstBloodKill`/`firstBloodAssist`, `firstTowerKill`/`firstTowerAssist`, `totalTimeSpentDead`, `longestTimeSpentLiving`, `goldEarned`, `totalMinionsKilled`, `neutralMinionsKilled`, `totalDamageDealtToChampions`, `damageDealtToObjectives`, `timeCCingOthers`, plus ping counts such as `enemyVisionPings`.
  - **`ChallengesDto`** (147 fields) includes: `killParticipation`, `kda`, `damagePerMinute`, `goldPerMinute`, `teamDamagePercentage`, `visionScorePerMinute`, `laneMinionsFirst10Minutes`, `jungleCsBefore10Minutes`, `maxCsAdvantageOnLaneOpponent`, `maxLevelLeadLaneOpponent`, `earlyLaningPhaseGoldExpAdvantage`, `laningPhaseGoldExpAdvantage`, `visionScoreAdvantageLaneOpponent`, `wardTakedowns`, `wardTakedownsBefore20M`, `controlWardsPlaced`, `controlWardTimeCoverageInRiverOrEnemyHalf`, `takedownsFirstXMinutes`, `turretPlatesTaken`, `soloKills`, `bountyGold`.
  - The spec gives no formula definitions.
- **Mobalytics GPI phase splits:** Early = first 15 min, Mid = 15-30, Late = 30+, for CS, gold and XP per minute. "Farm Efficiency" counts only time spent farming, excluding time dead or in base. — [Mobalytics GPI](https://web.archive.org/web/20241201175129/https://mobalytics.gg/gpi/)

### Inferences
**Standard expansions [unverified; the OE definitions table was not retrievable]**

| Code | Meaning |
|---|---|
| GD10/15 | team or player gold minus lane opponent's at 10:00/15:00 |
| XPD | experience difference |
| CSD | CS difference |
| CSPM | CS per minute |
| CS%P15 | share of team CS after 15:00 |
| DPM | damage to champions per minute |
| DMG% | share of team champion damage |
| GOLD% / EGPM | earned-gold share / earned gold per minute, excluding passive and starting gold |
| KP | (K+A) ÷ team kills |
| DTH% | share of team deaths |
| WPM / WCPM / CWPM | wards placed / wards cleared / control wards bought per minute |
| VSPM | vision score per minute |
| CKPM | combined kills per minute, both teams |
| AGT | average game time |
| FB% / FT% / F3T% / FD% | first blood / first tower / first to three towers / first dragon rate |
| HLD% | first Herald rate |
| BN% / FBN% | Baron control / first Baron rate |
| ELD% | Elder control |
| DRG% | dragon control |
| LNE% / JNG% | lane / jungle CS share |
| CTR% | counter-jungling share |
| STL | steals |
| PPG | plates per game |
| GPR | gold percent rating |

For solo-queue use, compute these from match-v5: GD@15 = `totalGold` difference in the frame at 15:00, XPD@15 from `xp`, CSD from `minionsKilled` + `jungleMinionsKilled`. Prefer Riot's `challenges` values where they exist, so numbers match other sites.

### Gaps
- The exact Oracle's Elixir definition strings are missing: the API needs a key, and the Wayback copy rendered empty.
- No authoritative definitions were found for:
  - Riot's `challenges` fields, such as the exact window for `laningPhaseGoldExpAdvantage`
  - Mobalytics' current GPI formulas
