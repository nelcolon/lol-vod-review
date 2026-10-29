# Existing LoL (PC) Gameplay Recording, Auto-Clipping and VOD Review Products (as of Oct 2026)

Research note: about 25 tool calls. The session-wide WebSearch budget ran out partway through (the limit is shared by all agents), so Eklipse, Powder (beyond its shutdown), AMD ReLive, Xbox Game Bar, Blitz, U.GG, Facecheck and LeagueReplays could not be checked. They are listed under Gaps rather than guessed at. Several sources are vendor or competitor marketing; each one is flagged where it is cited.

## Q1. Which event-detection mechanism does each product use, and how reliable is it reported to be?

### Takeaway
There are four ways products learn what happened in a game. Overwolf apps (Outplayed, older Insights, Mobalytics, Porofessor) use Overwolf's Game Events Provider (GEP), which itself wraps Riot's local Live Client Data API. Standalone recorders (Medal, Insights V3, Ascent, SteelSeries Moments) read game events directly. That is most likely the Live Client Data API, but it is not documented. Allstar is cloud-based: it renders clips from match data and replays after you link your Riot account. GeForce NOW's Highlights uses cloud image recognition. I found no independent reliability benchmarks. Reliability complaints mostly blame the Overwolf stack.

### Cited Findings
**Riot primitives**
- Riot's Game Client API is served locally by the game at `https://127.0.0.1:2999` with a self-signed certificate. It is "only available locally for native applications." Its endpoints under `/liveclientdata/` include `allgamedata`, `activeplayer`, `playerlist`, `playerscores`, `playeritems`, `eventdata` and `gamestats`. `eventdata` returns an `Events` array of `{EventID, EventName, EventTime}`. — [Riot Developer Docs, LoL](https://developer.riotgames.com/docs/lol)
- The Replay API is off by default. It is enabled with `EnableReplayApi=1` under `[General]` in `game.cfg`. Endpoints: `/replay/playback` (play, pause, seek), `/replay/render` (camera and render properties), `/replay/recording` (POST a codec and output path to render video), `/replay/sequence` (keyframes). League Director is the referenced open-source user. — [Riot Developer Docs, LoL](https://developer.riotgames.com/docs/lol)
- RCVolus/league-observer-tool uses the game's "LiveEvents" API (enabled by editing `game.cfg`) for events such as Dragon and Baron kills, and the Replay API for time controls. LeagueBroadcast uses more LiveEvents, so the two can conflict. — [GitHub RCVolus/league-observer-tool](https://www.github.com/RCVolus/league-observer-tool)

**Overwolf GEP (LoL)**
- Info-update features: `gep_internal`, `live_client_data`, `matchState`, `match_info`, `death`, `abilities`, `kill`, `gold`, `minions`, `summoner_info`, `teams`, `level`, `counters`, `damage`, `heal`, `jungle_camps`, `team_frames`, `panel_location`, `augments`. Event features: `respawn`, `abilities`, `assist`, `matchState`, `death`, `kill`, `announcer`, `counters`, `damage`, `chat`. — [Overwolf dev docs, LoL GEP](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/league-of-legends/)
- Known GEP quirks: `matchEnd` is deprecated (use `announcer` VICTORY/DEFEAT instead); `gameMode` is "incorrect" (use `queueId`); there is no matchOutcome event; `teams` can arrive late; `usedAbility` is disabled for Udyr; jungle camp IDs change over time; `chat` must not be logged. Brawl match history is not in the public API, and Riot does not approve aggregating Brawl data. — [Overwolf dev docs](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/league-of-legends/)

**Per product**
- **Outplayed:** an Overwolf app ("cannot run without the Overwolf client") that detects kills, deaths and objectives through Overwolf's game events system. — [Insights.gg blog, Oct 8 2026 (competitor)](https://insights.gg/blog/insights-vs-outplayed); [Overwolf support](https://support.overwolf.com/support/solutions/articles/9000188179)
- **Insights Capture:** originally used the OBS client bundled with Overwolf plus the Overwolf "Game Event" system. It was later rebuilt as a standalone app that does not require Overwolf; V3 is "fully standalone." A Feb 2023 Insights post blamed broken Valorant recordings on an Overwolf game-event change. — [Insights community: Overwolf FAQ](https://insights.gg/community/d/19-overwolf-insights-capture); [GamesBeat](https://gamesbeat.com/insights-gg-launches-stand-alone-platform-for-gameplay-capture/); [Insights 2/9/2023 update](https://insights.gg/community/d/30-my-valorant-recording-stops-half-way-through-the-game-d); [Insights blog (vendor)](https://insights.gg/blog/insights-vs-outplayed)
- **Medal.tv:** standalone. "The instant the game reports a kill, ace, goal, or win, Medal saves the seconds around that moment." Streamer Mode can block the match information Medal relies on, and some games need their replay system enabled. The detection method is not named. — [Medal auto-clipping page](https://medal.tv/auto-clipping)
- **Allstar.gg:** cloud-based. You link your Riot account at allstar.gg/match-history, pick a region, then open a match to create clips or remix auto-generated ones. A competitor describes it as cloud-rendered clips that put no load on your PC. — [Allstar Help Center](https://help.allstar.gg/hc/en-us/articles/22183183418647) (403 when fetched; summary from the search snippet); [Eklipse comparison (competitor)](https://eklipse.gg/compare/allstar-alternatives/)
- **SteelSeries GG Moments:** auto-clipped LoL from launch (alongside CS:GO and Dota 2). Each game has its own trigger events that can be toggled individually, and clips are labeled by the triggering event. — [Shacknews (launch, older)](https://shacknews.com/article/124200/steelseries-moments-software-can-capture-and-edit-your-gameplay?amphtml=1); [SteelSeries blog how-to](https://steelseries.com/blog/how-to-clip-rainbox-six-siege-record-video-1071)
- **NVIDIA Highlights:** GeForce NOW release 2.0.20 named LoL as one of its first two Highlights games, using "smart pattern and image recognition in our cloud servers," which is a screen-recognition approach. Wccftech also lists LoL as a GeForce NOW Highlights game. The NVIDIA App page says only that Highlights "automatically captures key moments" and does not confirm LoL for local PC play. — [NVIDIA GFN 2.0.20 notes](https://www.nvidia.com/en-us/geforce/release-notes/GFN/2_0_20/Rich/gfn-v2_0_20-rich-release-highlights/); [Wccftech](https://wccftech.com/geforce-now-gets-nvidia-highlights-support-for-dota-2-and-nine-new-games/); [NVIDIA App](https://www.nvidia.com/en-us/geforce/geforce-experience/)
- **Mobalytics Smart Highlights:** launched early 2022 as a Plus feature using an algorithm that scans the match for key moments. Clips generate right after each game and show damage stats and the items held at that moment. Mobalytics runs on Overwolf. — [Mobalytics dev blog](https://mobalytics.gg/blog/dev-blog-post-game-highlights/); [Mobalytics Smart Highlights page](https://mobalytics.gg/lol/glp/smart-highlights-1)
- **Ascent (tryascent.gg, newer):** standalone, "no Overwolf," automatic recording of LoL. Promoted on r/leagueoflegends in March 2026 with a claim of more than 40k users. The detection method is not disclosed, and questions about the "AI" went unanswered in the thread. — [Reddit snapshot, Mar 2026](https://reddit.sentinel-team.org/posts/1rq5nze/snapshots/2026-03-11T22%3A53%3A14.837976Z)
- **DOR (clip.dor.gg, commercial):** detects kills and multikills and saves them as clips, with a hotkey that saves the last 30 seconds. It uses a replay-buffer model that keeps the last 20 to 30 seconds in memory. — [DOR blog](https://clip.dor.gg/en/blog/how-to-record-league-of-legends); [DOR replay buffer post](https://clip.dor.gg/en/blog/obs-replay-buffer-highlights)

### Inferences
- The Live Client Data API is the common source for almost everyone. Overwolf's GEP even lists a `live_client_data` feature. So "missed events" are more likely caused by the recorder (encoder or hook failures, Streamer Mode) than by the data source.
- The Live Client Data API does not report objective events from the jungle camp perspective as cleanly as kills. In GEP, objectives come only through the `jungle_camps` info updates and `announcer`. That fits the pattern of products advertising kill events more reliably than objective events.

### Gaps
- I found no independent measurements of missed-event rates for any product.
- Medal, SteelSeries and Ascent do not publicly document their detection method; the Live Client Data API is inferred, not confirmed.
- I could not verify NVIDIA App (local) LoL Highlights support in 2026.
- AMD ReLive and Xbox Game Bar were not researched because the search budget ran out. They are generally understood to have no LoL event integration, but I have no source for that.

## Q2. Which exact "moments" do they detect?

### Takeaway
Medal publishes the most complete LoL event list: kills and multikills, ace, steals and kills of Baron, Herald, Dragon and Voidgrubs, turret, inhibitor, deaths and assists. Overwolf GEP exposes kills and multikills, deaths, assists, respawn, announcer turret and inhibitor events, and jungle camps (Dragon, Baron, Herald, VoidGrubs, Atakhan). Insights advertises pentakills, baron and objective steals, and teamfight wins. None of the sources explicitly list first blood or level-ups as clip triggers.

### Cited Findings
- **Medal LoL events:** Enemy Slain, Double, Triple and Quadra Kill, Pentakill, Ace, Baron Steal and Kill, Herald Steal and Kill, Dragon Steal and Kill, Voidgrub Steal and Kill, Turret Destroyed, Inhibitor Destroyed, Player Slain, Assist. — [Medal auto-clipping](https://medal.tv/auto-clipping)
- **Overwolf GEP:** the `kill` event label is kill, double_kill, triple_kill, quadra_kill or penta_kill, with counts. `announcer` carries multikill announcements (including the enemy's), turret_destroy, inhibitor_destroy and VICTORY/DEFEAT. There are `death`, `respawn` and `assist` events. There are no dedicated dragon, baron or herald events; these appear only in `jungle_camps` as camp names (Dragon, Baron, Rift Herald, VoidGrubs, Atakhan), and Baron, Herald, VoidGrubs and Atakhan always show a zero icon status. `level` is available as an info update. — [Overwolf dev docs](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/league-of-legends/)
- **Insights Capture LoL:** kills, deaths and assists; pentakills, baron steals and objective steals; teamfight wins; dragons and barons timestamped on the timeline. — [Insights LoL page (vendor)](https://insights.gg/games/league-of-legends)
- **Outplayed:** kills, deaths and objectives, from a competitor's summary. — [Insights blog](https://insights.gg/blog/insights-vs-outplayed)
- **DOR:** kills and multikills. — [DOR blog](https://clip.dor.gg/en/blog/how-to-record-league-of-legends)

### Inferences
- A "full" LoL event set across the market is: own kill and death, assist, multikills up to penta, ace, objective kills and steals (dragon, baron, herald, voidgrubs, and now Atakhan), turret, inhibitor and game end. Steal detection relies on the killer team and the camp, which the Live Client Data `eventdata` exposes (fields such as `Stolen` on DragonKill and BaronKill events, from general knowledge; not verified here because Riot's page does not list event names).

### Gaps
- Riot's docs page does not list `EventName` values (it links a sample JSON). I could not confirm the canonical names (ChampionKill, Multikill, Ace, FirstBlood, DragonKill, HeraldKill, BaronKill, TurretKilled, InhibKilled and so on) from a fetched source.
- No source lists first blood or level-up triggers for any product.
- I could not obtain Outplayed's or SteelSeries' exact LoL event lists.

## Q3. Recording approach and common review UX patterns

### Takeaway
Two recording models dominate. Full-match recording with event bookmarks (Outplayed full-match mode, Insights, Ascent) suits VOD review. A replay buffer with event-triggered clips (Outplayed highlight mode, Medal, DOR, SteelSeries, ShadowPlay) suits highlights. Common review UX: a post-match timeline with clickable event markers, a clip list, a trimmer, auto-stitched montages (Outplayed "Supercut"), and share links. Only Insights advertises coach-style tools (timestamped comments, drawing on frames, multi-player merged recordings).

### Cited Findings
- **Outplayed modes:** highlight mode ("short clips of your best moments"), full-match mode ("entire match with automatic bookmarking of key events"), and full session. After the match, a timeline lets you flip through clips and view APM. Built-in editor with trimming and Supercut stitching. Settings cover resolution, FPS and encoder. — [Overwolf support](https://support.overwolf.com/support/solutions/articles/9000188179); [Overwolf Outplayed app page](https://overwolf.com/oneapp/Overwolf-Outplayed); [Insights blog](https://insights.gg/blog/insights-vs-outplayed)
- **Insights Capture:** recording starts at champion select and "runs to the nexus." Manual clip and trim are available for missed moments. A timeline of game events appears after every LoL and Valorant match, and clicking a marker jumps to that segment. The VOD Review workspace supports timestamps, drawing on frames, comments and collaborative sessions. Recordings from multiple players can be merged. Cloud share links do not expire. Sharing to Discord, TikTok and YouTube. — [Insights LoL page](https://insights.gg/games/league-of-legends); [Overwolf listing](https://www.overwolf.com/app/Insights_Gaming-Insights_Capture); [GamesBeat](https://gamesbeat.com/insights-gg-launches-stand-alone-platform-for-gameplay-capture/); [Insights blog](https://insights.gg/blog/insights-vs-outplayed)
- **Medal:** clips cover "the seconds around" each event. A separate instant-replay hotkey (F8) saves 15 seconds to 10 minutes. — [Medal auto-clipping](https://medal.tv/auto-clipping)
- **SteelSeries Moments:** auto-clips follow the global clip length and quality settings and are labeled by trigger event in the catalogue. — [SteelSeries blog](https://steelseries.com/blog/how-to-clip-rainbox-six-siege-record-video-1071)
- **Ascent:** full-game auto-recording, "detailed search," clip and gameplay sharing links, a timeline with a gold graph (users asked for a toggle), and an adjustable pre-event buffer that users requested. Some users record straight to a NAS. — [Reddit snapshot, Mar 2026](https://reddit.sentinel-team.org/posts/1rq5nze/snapshots/2026-03-11T22%3A53%3A14.837976Z)
- **Mobalytics:** highlights auto-generate after each game, with damage stats and items overlaid as context. Free accounts get 1 clip per game and Plus gets 5 (2022 terms). — [Mobalytics dev blog](https://mobalytics.gg/blog/dev-blog-post-game-highlights/); [Mobalytics Smart Highlights](https://mobalytics.gg/lol/glp/smart-highlights-1)
- **Allstar:** clips are created per match on the web, with "Remix" of already-generated content. — [Allstar Help Center](https://help.allstar.gg/hc/en-us/articles/22183183418647)
- **ReplayBook:** free, open-source (GPL-3.0) manager for downloaded .rofl replays: organize, play and inspect. It replaces the archived ROFL Player. Replays from patches 14.9 to 14.10 contain no metadata and are unsupported. The repo has about 456 stars and 60 forks. Release 1.7.7 was published 2025-03-02. — [GitHub fraxiinus/ReplayBook](https://github.com/fraxiinus/ReplayBook); [repositorystats](https://repositorystats.com/fraxiinus/replaybook); [ROFL Player archive](https://github.fontlos.workers.dev/fraxiinus/ROFL-Player)
- The Riot Replay API can seek, play and pause, control the camera, and render to video (`/replay/recording`). League Director uses it. — [Riot Developer Docs](https://developer.riotgames.com/docs/lol)

### Inferences
- No product found combines full-match recording, an event timeline, and an automatically generated "mistakes" list (for example, deaths annotated with a cause from Riot timeline data). Insights comes closest for human review; Mobalytics comes closest for data context on clips.
- Pre/post-roll length is rarely exposed per event. Ascent users explicitly ask for it, which suggests a UX gap.

### Gaps
- I could not confirm exact default pre/post-roll durations for Outplayed, Medal or SteelSeries.
- I could not confirm whether any product offers playback speed controls or a death recap view specifically.

## Q4. What do users complain about most?

### Takeaway
The complaints that recur: Overwolf dependency and bloat, ads on free tiers, Outplayed being "buggy for months" and breaking after updates or driver changes, FPS overhead, and games that silently fail to record. Newer Overwolf-free entrants (Ascent, Insights V3) market themselves directly against these complaints.

### Cited Findings
- A commenter called Outplayed "a buggy mess for months" with ads. Ascent's whole pitch is "No ads, no Overwolf, near 0 FPS impact," though a commenter called the "Zero performance impact" claim an exaggeration. Ascent's own issues: games not auto-recording (later fixed), a frozen-video-with-audio bug after an update, a VirusTotal false positive, and problems with outdated NVIDIA drivers. Users also asked about storage management and cloud costs. — [Reddit snapshot, Mar 2026](https://reddit.sentinel-team.org/posts/1rq5nze/snapshots/2026-03-11T22%3A53%3A14.837976Z)
- Insights (a competitor) lists Outplayed pain points: it requires the Overwolf client, overlays and background processes; the free tier has ads; driver conflicts, reinstalls and capture breaking after updates; no team review workspace. — [Insights blog, Oct 8 2026](https://insights.gg/blog/insights-vs-outplayed)
- Third-party troubleshooting guides give these causes of "Outplayed not recording": below-minimum hardware, outdated drivers, unsupported games or launch modes, wrong capture settings, conflicting capture apps, and Overwolf outages ("the recorder ... will be temporarily unavailable"). They recommend lowering bitrate and FPS to reduce frame drops. — [DOR blog](https://clip.dor.gg/en/blog/outplayed-not-recording); [EaseUS](https://recorder.easeus.com/screen-recording-resource/overwolf-not-recording.html); [MiniTool](https://videoconvert.minitool.com/news/outplayed-not-recording.html)
- Insights' own history includes recordings stopping mid-game after an Overwolf game-event change (Valorant, Feb 2023). — [Insights community](https://insights.gg/community/d/30-my-valorant-recording-stops-half-way-through-the-game-d)
- Streamer Mode in LoL can block the match data Medal uses for auto-clipping. — [Medal](https://medal.tv/auto-clipping)

### Inferences
- "Not Overwolf, no ads, low FPS cost, reliable start/stop" is now the baseline positioning for new LoL recorders in 2026.

### Gaps
- I could not gather Reddit, r/Overwolf or Steam review threads directly (search budget). The complaint evidence is thin and partly vendor-sourced.

## Q5. Which products are confirmed to work alongside Vanguard, and have any been blocked or flagged?

### Takeaway
I found no product publicly blocked by Vanguard. Compatibility claims come from the app makers, not from Riot. Riot runs Vanguard on LoL and states it can block unauthorized apps. The bigger Riot-driven change was policy, not technical: a reported 2025 ban on third-party in-game ads, which hits Overwolf's ad model.

### Cited Findings
- Vanguard can block unauthorized apps (cheats, scripts) and is required to play LoL. Mobalytics says it is "allowed by Vanguard" because it is compliant with Riot's ToS, but it "can't speak for other clients" and advises assuming others are not allowed until told otherwise. This is a vendor statement; the page returned 403 when fetched, so this comes from the search snippet. — [Mobalytics blog: Vanguard and Mobalytics](https://mobalytics.gg/blog/lol-vanguard-and-mobalytics/)
- Overwolf says it works with publishers so apps comply with game terms. — [Overwolf commitment](https://www.overwolf.com/our-commitment)
- Riot reportedly announced in 2025 that third-party in-game ads (overlays, loading screens, Riot Client) are no longer allowed. This is a secondhand report of an Overwolf blog post that I could not verify directly. — [search result via lilachbullock.com / Overwolf](https://www.lilachbullock.com/?p=146724)
- Insights, Medal, Ascent and Outplayed all actively market LoL support in 2026, which implies they function under Vanguard. — [Insights LoL](https://insights.gg/games/league-of-legends); [Medal](https://medal.tv/auto-clipping); [Reddit/Ascent](https://reddit.sentinel-team.org/posts/1rq5nze/snapshots/2026-03-11T22%3A53%3A14.837976Z)

### Inferences
- Since all of these read the Riot-sanctioned local API and capture through normal Windows APIs, they are unlikely Vanguard targets. The risk is injection-based overlays or capture hooks, not event reading.

### Gaps
- I found no Riot primary-source list of allowed recording tools, and no confirmed report of any recorder being flagged by Vanguard. I could not verify the 2025 ad-ban details from Riot's or Overwolf's own pages.

## Q6. Business models and shutdowns

### Takeaway
The models in use: ad-supported freemium (Outplayed with Premium, Overwolf apps generally), subscriptions for storage and features (Mobalytics Plus, Insights paid plans, Ascent premium, Medal Premium), and rewards (Insights "Shards" gift cards). Two notable shutdowns: Powder (AI clipping; closure announced late 2024 per competitor blogs) and SenpAI.gg (YC S21 AI coach; listed as closed or inactive, with no reason given).

### Cited Findings
- **Outplayed:** free with ads; Outplayed Premium removes them (price not stated). — [Insights blog (competitor)](https://insights.gg/blog/insights-vs-outplayed)
- **Insights Capture:** free (recordings, auto highlights, basic storage), with no ads or watermark; paid plans add cloud space and team features; the Shard program pays gift cards while the recorder runs during bounties. — [Insights LoL page](https://insights.gg/games/league-of-legends); [Insights blog](https://insights.gg/blog/insights-vs-outplayed)
- **Ascent:** free tier with cloud storage plus a paid tier that subsidizes storage (from comments; what is paywalled is unclear). — [Reddit snapshot](https://reddit.sentinel-team.org/posts/1rq5nze/snapshots/2026-03-11T22%3A53%3A14.837976Z)
- **Mobalytics:** Smart Highlights is a Plus feature (5 clips per game vs 1 for free, 2022). — [Mobalytics dev blog](https://mobalytics.gg/blog/dev-blog-post-game-highlights/)
- **Porofessor (M.O.B.A. Network):** 15.5M installs (June 2025 press release), plus plans for a higher-priced premium tier. Clip recording was not mentioned. — [M.O.B.A. Network PR](https://storage.mfn.se/874750fb-1026-454f-9dd8-5a6d54a920af/porofessor-reaches-15-5-million-installs-as-premium-strategy-and-monetization-framework-deepen.pdf)
- **Powder.gg:** AI-driven game clipping with social sharing; shutdown reportedly announced late 2024. Its console connection was "sometimes unreliable." All three sources are competitor blogs. — [StreamLadder](https://streamladder.com/blog/powder-gg-is-shutting-down-the-best-alternative-for-streamers-in-2025); [Eklipse vs Powder](https://blog.eklipse.gg/tools/eklipse-vs-powder-gg.html); [Eklipse alternatives](https://blog.eklipse.gg/tools/top-alternatives-powder-gg-tsai.html)
- **SenpAI.gg:** a Boston desktop app giving in-game recommendations and post-game feedback for LoL, Valorant and TFT; $3M seed (ACT Venture Partners); YC S21. Dealroom lists it as closed, and YC reportedly lists it as inactive. No date or reason found. — [TechCrunch 2021](https://techcrunch.com/2021/08/06/senpai-gg-wants-to-be-your-ai-powered-video-game-coach); [Dealroom](https://app.dealroom.co/companies/senpai); [YC](https://www.ycombinator.com/companies/senpai-gg)
- **Newer AI coaching (2024–2026):** mostly hobby or hackathon projects. "Rise to Challenger" (Streamlit) pulls Riot match and timeline data, benchmarks against Challenger averages, and generates post-game feedback. "Zenith" (Devpost) works on GRID pro esports data. I could not confirm a live commercial AI VOD "mistakes" product. — [Streamlit forum](https://discuss.streamlit.io/t/rise-to-challenger-ai-powered-lol-coaching-app/121487); [Devpost Zenith](https://devpost.com/software/zenith-ai-powered-esports-coach); [TurboStarter concept pages (not products)](https://www.turbostarter.dev/ideas/ai/vod-insight-pro)
- **Open source:** I found no verified GitHub repo that auto-clips LoL by combining the Live Client Data API with an OBS replay buffer. Adjacent projects: RCVolus league-observer-tool (LiveEvents plus Replay API), DataNashor (a PyPI live-data and replay parser, no recording), and OBSAutoReplay (a replay buffer helper with no game events). — [league-observer-tool](https://www.github.com/RCVolus/league-observer-tool); [DataNashor PyPI](https://pypi.org/project/datanashor/0.4.3/); [OBSAutoReplay](https://obsproject.com/forum/resources/obsautoreplay.1894/version/5467/download)

### Inferences
- If Riot's 2025 in-game ad ban is accurate, ad-funded Overwolf recorders such as Outplayed are under pressure. That may explain the 2025–2026 shift toward standalone, ad-free, subscription-or-storage models (Insights V3, Ascent).
- The AI-coaching category has a poor survival record (SenpAI closed; Powder closed). The AI-coach niche based on timeline-derived "mistakes" looks open, with only hobby projects in it.

### Gaps
- Not researched (search budget exhausted): Eklipse (cloud AI highlights from Twitch/VODs), Medal Premium pricing, Allstar pricing, AMD ReLive, Xbox Game Bar, Blitz.gg (any clip or recording feature), U.GG app, Facecheck, LeagueReplays (an older .rofl manager, likely defunct), Outplayed Premium price, and Outplayed's current status and changelog.
- I found no exact date or reason for the Powder or SenpAI shutdowns from a primary source.
