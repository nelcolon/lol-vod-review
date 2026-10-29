# Riot Vanguard constraints on third-party recording / overlay / companion apps for League of Legends (as of Oct 2026)

Research note scope: compliance only (no evasion). Research was cut short. The session's shared WebSearch budget ran out after 3 searches, so most findings come from direct fetches of Riot support / dev pages and OBS forum threads. Several key questions (named driver blocklist, Overwolf–Riot agreement, Discord/Steam/Medal incidents, LCU/2999 behavior under Vanguard) could not be sourced and are listed as Gaps. Labels: **[OFFICIAL]** = Riot / Overwolf / OBS first-party; **[COMMUNITY]** = forum / third-party guide.

## 1. What Vanguard actually blocks or flags (drivers, injection, memory, VMs, Windows security settings, input automation)

### Takeaway
Riot says Vanguard (a) stops known signed-but-vulnerable drivers from loading, (b) watches for and prevents tampering with the signed League process, (c) detects synthetic input sent to the game and records the sending process name, and (d) can refuse to launch until TPM 2.0, Secure Boot, Memory Integrity (HVCI/VBS) and IOMMU are on. Riot has published no list of blocked drivers. Users only learn which file is blocked when the error names it.

### Cited Findings
- [OFFICIAL] Vanguard has "a client that runs while our games are active along with a kernel mode driver". It is "usually an on-boot application", and it can block files from loading (example notification: "Vanguard has blocked the following file from loading on your system: …"). It "informs you what vulnerable vectors are being affected through a Windows notification". Article dated 2026-06-02. — [What is Vanguard? (Riot Support)](https://support.riotgames.com/en-us/riot/performance/what-is-vanguard)
- [OFFICIAL] On vulnerable drivers: "we made the decision to have Vanguard utilize its on-boot positioning to prevent known signed-but-vulnerable drivers from loading in their entirety". Example: a keyboard-lighting driver abused to load cheat malware was "denylisted until the developers released a new one". Dev blog by mirageofpenguins, 2024-04-11. — [/dev: Vanguard x LoL (leagueoflegends.com)](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)
- [OFFICIAL] On game-process protection: the client "contacts the driver to confirm that it thinks everything is 100%" before a session is issued, then "instructions from the client then start enabling features within the driver to watch for things that might tamper with the signed League process and prevent them." — [/dev: Vanguard x LoL](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)
- [OFFICIAL] On input automation: one Vanguard check is "did an application just try to submit input to the game". The response is mostly binary "though the latter includes the name of the process that did it". — [/dev: Vanguard x LoL](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)
- [OFFICIAL] On memory reading by third-party tools: "it is our vast preference that everyone just use the API … If tools choose to read client memory anyway, we make no guarantees that it won't break. In fact, we promise to deliberately break it as often as possible." — [/dev: Vanguard x LoL](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)
- [OFFICIAL] The same blog names pirated software that toggles the "DevOverrideEnable" registry option as a major source of Vanguard bugs. The driver makes no calls until a Riot game runs. If Vanguard is disabled, a reboot is needed before playing. — [/dev: Vanguard x LoL](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)
- [OFFICIAL] On security requirements: "Riot Vanguard may require certain Windows security features to be enabled before launching Riot games". The features listed are TPM 2.0, Secure Boot, Memory Integrity (HVCI/VBS) and IOMMU. No per-game or per-region enforcement dates are given. Article dated 2026-05-31. — [Vanguard Security Requirements](https://support.riotgames.com/en-us/riot/performance/vanguard-security-requirements)
- [OFFICIAL] VAN: RESTRICTION "means Vanguard currently requires a Windows update or security setting change before your game can launch". Triggers are a required Windows update or a required security feature (TPM 2.0, Secure Boot, HVCI/VBS, IOMMU). Third-party software is not listed as a trigger. Dated 2026-05-29. — [VAN: RESTRICTION](https://support.riotgames.com/en-us/riot/penalties/error-van-restriction)
- [OFFICIAL] VAN: RESTRICTION: 5 appears when Vanguard cannot verify that "Memory Integrity, also known as HVCI/VBS" is enabled and running. Causes: Memory Integrity off, virtualization not fully enabled, or BIOS/UEFI security settings (search snippet: NX/XD disabled). Dated 2026-03-13. — [Error VAN: RESTRICTION: 5](https://support.riotgames.com/en-us/riot/penalties/error-van-restriction-5)
- [OFFICIAL] "VAN: Incompatible Software" is a named error in which Vanguard "tells you exactly which file is causing the problem" (a .sys path). The fix is to uninstall the owning program, or delete the .sys, then reboot. No third-party software is named. Dated 2026-01-27. — [VAN: Incompatible Software](https://support.riotgames.com/en-us/valorant/performance/van-incompatible-software)
- [OFFICIAL] The error-code index (dated 2026-05-22) lists "Incompatible Software", "Incompatible OEM Driver", STATUS_SB_POLICY, VAN 9001/STATUS_VMD_9001, 9002–9006, 9051, 9090, 9100, 9101, 138, 152, 1067, -81 and others. The index gives no meanings; each code links to its own article. — [Vanguard Error Codes](https://support.riotgames.com/en-us/riot/performance/vanguard-error-codes)
- [COMMUNITY] A third-party guide says the incompatible-software error usually names a .sys file. It lists ene.sys (RGB lighting controllers) and RTCore64.sys (MSI Afterburner / RivaTuner) as frequent culprits. — [thespike.gg](https://www.thespike.gg/valorant/error-codes/fixing-the-valorant-incompatible-software-component-detected-error)
- [COMMUNITY] VAN 1067 is described as a general startup/verification failure that Riot attributes to "unusual software installed on your computer". — [thespike.gg VAN 1067](https://www.thespike.gg/league-of-legends/errors/vanguard-1067-error-fix); [Appuals](https://appuals.com/league-of-legends-van-1067/)

### Inferences
- An app that installs no kernel driver, injects nothing, never opens the League process for VM_READ/VM_WRITE and never sends input has none of the officially described triggers.
- The worst risk for a recorder is shipping or depending on a kernel driver, such as an old hardware-monitor library (WinRing0 or RTCore-style) used for FPS/temperature overlays. That driver could be denylisted and block the game for every user who has it installed.
- Synthetic input is detected and attributed by process name, so any "auto-pause", "auto-clip hotkey" or "replay control" feature must never inject keystrokes or mouse events into the League window (SendInput, PostMessage to the game window, etc.). Use global hotkey *listening* (RegisterHotKey) in your own process instead. Whether Vanguard flags passive low-level keyboard hooks (WH_KEYBOARD_LL) is not documented; see Gaps.

### Gaps
- No official, public list of blocked drivers exists. Riot only names the blocked file at runtime. Claims about RTCore64.sys, cpuz*.sys, WinRing0, ene.sys and similar drivers come from community sources only, and the search budget did not allow verification.
- Riot does not document whether test-signing mode or a disabled HVCI produces a specific VAN code for League (as opposed to VALORANT). The RESTRICTION articles are cross-game.
- The meaning of VAN 9001 / 9003 for League in 2026 could not be fetched (the guessed URL returned 404).

## 2. Official Riot statements on recording / streaming / overlay software (OBS, ShadowPlay, Medal, Discord, Overwolf); compatible-software list; Overwolf–Riot relationship

### Takeaway
I found no Riot list of compatible or incompatible recording software. The Riot support articles I read (What is Vanguard, Security Requirements, Error Codes, Incompatible Software) do not mention overlays, recording or macros. Riot's stated policy is to use official APIs. Overwolf's LoL docs show that Overwolf relays Riot's data rules (for example "Riot Games does NOT approve any Brawl related data…"), which implies a working relationship. I found no published whitelist.

### Cited Findings
- [OFFICIAL] "What is Vanguard?" does not mention third-party software, overlays, screen recording or macros. — [Riot Support](https://support.riotgames.com/en-us/riot/performance/what-is-vanguard)
- [OFFICIAL] The Technical Support hub lists six Vanguard articles (What is Vanguard, Error Codes, Penalty Restrictions, Security Requirements, Pre-Check, Uninstall/Disable). None covers third-party software, overlays or recording. — [Riot Technical Support hub](https://support.riotgames.com/en-us/riot/technical-support)
- [OFFICIAL] The Vanguard x LoL dev blog (2024-04-11) does not name OBS, Overwolf or overlays. Its only third-party guidance is "use the API" and that memory readers will be broken deliberately. — [/dev: Vanguard x LoL](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)
- [OFFICIAL – Overwolf] Overwolf's LoL Game Events page exposes `live_client_data` (active_player, all_players, events, game_data, port) plus Overwolf-specific features (matchState, damage, jungle_camps, chat, etc.). It relays Riot rules: "Riot Games does NOT approve any Brawl related data being aggregated or visible on third-party products/apps". Push runes/items features are not allowed in KR. The page does not mention Vanguard. It also states that from 2026-11-01 Overwolf will only approve apps that use Overwolf monetization (an Overwolf policy, not Riot's). — [Overwolf dev docs: League of Legends](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/league-of-legends/)
- [OFFICIAL] Riot Developer Portal general policies: "All products must be registered in, and audited by Riot Games through the Developer Portal". "Any new features or changes to a product must be audited". Products "cannot create an unfair advantage for players, like a cheating program". No MMR/ELO calculators, no de-anonymizing players, no ads in Riot properties (in-game, loading screens, Riot Client). The page does not address overlays or memory reading. — [Riot Developer Portal – General Policies](https://developer.riotgames.com/policies/general)

### Inferences
- The "official" path for a companion app is to register the product on the Riot Developer Portal and follow its game-integrity rules. That is a policy and ToS layer, separate from Vanguard's technical detection. The two should not be conflated: Vanguard does not check portal registration (no source says it does).
- Overwolf's value under Vanguard is that its in-game data and overlay pipeline is presumably coordinated with Riot (Overwolf relays Riot-specific approval rules). No source confirms an explicit Vanguard allowlist entry for Overwolf.

### Gaps
- No Riot statement was found on whether OBS, ShadowPlay/NVIDIA App, AMD ReLive, Medal, Outplayed, Insights Capture or the Discord overlay are "safe". The search budget was exhausted before Reddit, OBS GitHub or news coverage could be checked.
- The formal Overwolf–Riot partnership terms and any Vanguard-side allowlist are unverified.

## 3. OBS Game Capture (graphics-hook injection) vs. Windows Graphics Capture / DXGI Desktop Duplication

### Takeaway
Community reports from January 2025 (OBS 31) and July 2026 (OBS 32.1.0) show OBS Game Capture of League going black or lagging, with Window Capture or Display Capture as the workaround. Users blame Vanguard. Neither OBS nor Riot has confirmed this. An app that relies on injecting a hook DLL into League is therefore fragile even when the DLL is signed. Non-injecting capture (WGC, DXGI duplication) is what the workarounds use.

### Cited Findings
- [COMMUNITY] 2025-01-18 to 2025-01-20, OBS forum, "No puedo stremear LEAGUE OF LEGENDS". Several users report that after updating OBS, League lags or freezes (FPS 0) and Game Capture shows black. Turning off "anti-cheat compatibility" stopped the lag but still produced a black preview. A forum helper (PaiSand) says the problem has been known "since version 31" and attributes it to OBS's certificate signatures being incompatible with the anti-cheat (unverified). Recommended workaround: Window or Display capture. — [OBS Forums thread 183334](https://obsproject.com/forum/threads/no-puedo-stremear-league-of-legends.183334/)
- [COMMUNITY] 2026-07-21/22, OBS forum, "Game Capture Black Screen With only League of Legends". Game Capture is black for League only (audio and cursor work; other games capture fine). It started suddenly with no local changes, on OBS 32.1.0 portable, and downgrading to 30.2.3 did not help. Users suspect Vanguard from the timing. An unverified relayed claim says the standard installer (which "registers graphics-hook64.dll") is the fix, versus portable mode. No OBS developer responded. Window Capture works but is less smooth, and Screen Capture works. — [OBS Forums thread 195861](https://obsproject.com/forum/threads/game-capture-black-screen-with-only-league-of-legends.195861/)
- [OFFICIAL] Vanguard's driver watches "for things that might tamper with the signed League process and prevent them". This is a plausible mechanism for blocked hook injection, though Riot does not name OBS. — [/dev: Vanguard x LoL](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)

### Inferences
- The black-screen-not-ban pattern (the game keeps running and only the capture fails) suggests Vanguard blocks or neuters the hook silently rather than closing the game or penalizing the player. This rests on the two forum threads and is not confirmed.
- Windows Graphics Capture (WinRT `GraphicsCaptureItem` for the League HWND or monitor) and DXGI Desktop Duplication run in the compositor (DWM) path, outside the game process. They are what OBS Window/Display Capture use (WGC and DXGI on modern Windows), and those are exactly the community-confirmed working workarounds. They should be the default for a custom recorder. Caveat: no Riot source explicitly blesses them.
- A custom DLL hook (D3D11 Present hook, etc.) in League.exe should be treated as **will be blocked or deliberately broken**. Riot promises to break client-memory tools, and the driver prevents tampering with the signed process.

### Gaps
- No OBS developer or Riot statement was found explaining the 2025/2026 Game Capture failures. Whether an allowlist for OBS's graphics-hook exists is unknown. The OBS KB page on game capture returned 404, and the OBS 30.0.0 release notes fetched had no anti-cheat lines.
- No direct source confirms that WGC or DXGI capture of League works in October 2026. This is inferred from the "Window/Screen capture works" reports.

## 4. Reported incidents 2024–2026 (legitimate software triggering Vanguard) and false bans

### Takeaway
The only concrete, dated incidents verified here are the OBS Game Capture failures (January 2025 and July 2026), which were capture failures and not bans. Riot's own account of false bans says genuine false positives are rare and usually caused by malware. Riot says such suspensions rarely last more than a few days and can be audited via a support ticket.

### Cited Findings
- [COMMUNITY] OBS Game Capture black screen / lag with League (OBS 31), January 2025. — [OBS Forums 183334](https://obsproject.com/forum/threads/no-puedo-stremear-league-of-legends.183334/)
- [COMMUNITY] OBS 32.1.0 Game Capture black screen with League only, 2026-07-21. — [OBS Forums 195861](https://obsproject.com/forum/threads/game-capture-black-screen-with-only-league-of-legends.195861/)
- [OFFICIAL] Riot lists categories of claimed false bans. Most are not real false positives (account sharing, boosters, cheat testing on smurfs, stolen accounts). Two edge categories are a player using cheat software for *another* game, which Vanguard "unfortunately picked up", and malware performing cheat-like operations. Genuine false positives are rare and "rarely" last more than a few days. Audits are requested via a support ticket. 2024-04-11. — [/dev: Vanguard x LoL](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)
- [OFFICIAL] Historical precedent: a keyboard-lighting driver was denylisted until the vendor shipped a fixed version. — [/dev: Vanguard x LoL](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)
- [COMMUNITY/press] The League rollout came with patch 14.9. TechSpot reports Riot said fewer than 0.03% of players reported errors, and that TPM 2.0 is required on Windows 11. — [TechSpot](https://www.techspot.com/news/102889-league-legends-receives-controversial-vanguard-anti-cheat-windows.html)
- [COMMUNITY/press] In VALORANT's 2020 launch period, Riot said "almost all of the software that Vanguard was previously blocking will work properly" and that only a small number of drivers remained blocked. — [The Loadout](https://www.theloadout.com/valorant/vanguard-changes-invasive-software) (via search snippet; the page was not fetched)

### Inferences
- The "cheat software for another game was picked up" category matters for a developer. Debuggers, memory scanners or hooking frameworks installed on the same PC for unrelated work could plausibly be flagged. Keep such tooling off the gaming machine, or at least make sure it is not running while League runs.

### Gaps
- I could not verify dated incidents involving MSI Afterburner/RTSS, iCUE/Armoury Crate/ENE RGB drivers, HWiNFO, CPU-Z, Discord overlay, Steam overlay, Medal, Outplayed or Blitz with League + Vanguard from 2024–2026. The search budget was exhausted. This needs a follow-up pass (Reddit r/leagueoflegends, r/VALORANT, PCGamer, The Verge, Dexerto).
- No dated LoL "false ban wave" incident was verified.

## 5. Live Client Data API (127.0.0.1:2999), LCU API, process list / window title / handle checks

### Takeaway
Riot's policy is "use the API", and Overwolf's own LoL integration exposes `live_client_data` (the 2999 data). No source shows that Vanguard blocks or penalizes local HTTP reads of 2999 or the LCU. Lightweight process detection (enumerating processes, reading window titles) is not mentioned anywhere as a trigger. Opening a handle with memory-read rights is exactly what Riot says it will break.

### Cited Findings
- [OFFICIAL] "it is our vast preference that everyone just use the API." — [/dev: Vanguard x LoL](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)
- [OFFICIAL – Overwolf] Overwolf GEP for LoL includes a `live_client_data` feature (active_player, all_players, events, game_data, port), meaning Overwolf itself consumes Live Client Data. — [Overwolf dev docs](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/league-of-legends/)
- [OFFICIAL] Products using the League Client API must register on the Developer Portal and follow the League Client documentation. — [Riot Developer Portal – General Policies](https://developer.riotgames.com/policies/general)

### Inferences
- Reading `https://127.0.0.1:2999/liveclientdata/*` (self-signed certificate) and the LCU (port and token from the lockfile) are sanctioned interfaces exposed by the client itself. Polling them at a modest rate (for example 1–2 Hz) does not interact with the game process memory, so it should be Vanguard-neutral.
- For game-start detection, prefer the LCU gameflow phase (`/lol-gameflow/v1/gameflow-phase` or its WebSocket event) or polling 2999 until it answers. As a fallback, enumerate processes by name (Toolhelp32 / WMI) or use FindWindow on the "League of Legends (TM) Client" window class or title. If you need the PID or the executable path, open only `PROCESS_QUERY_LIMITED_INFORMATION`. Never request `PROCESS_VM_READ`, `PROCESS_VM_WRITE`, `PROCESS_VM_OPERATION`, `PROCESS_CREATE_THREAD` or `PROCESS_ALL_ACCESS` on League processes. These are inferences from the "tamper with the signed League process" language, not documented thresholds.

### Gaps
- I found no explicit Riot statement confirming that 2999 or LCU access is unaffected by Vanguard, and no reported ban for using Live Client Data API tools (searches could not be run). The absence of evidence is not confirmed safety, though the API is Riot-provided.

## 6. Overwolf app vs. standalone exe; code signing (EV/OV); developer whitelist programs

### Takeaway
No source says Vanguard treats Overwolf apps differently from standalone executables, or that an EV/OV Authenticode signature on a user-mode app changes Vanguard's treatment. The only "registration" program found is the Riot Developer Portal product registration and audit, which is a policy and compliance mechanism. I found no evidence that it is a Vanguard allowlist.

### Cited Findings
- [OFFICIAL] All products must be "registered in, and audited by Riot Games through the Developer Portal", and feature changes must be re-audited. Monetized products must have status Approved or Acknowledged. — [Riot Developer Portal – General Policies](https://developer.riotgames.com/policies/general)
- [OFFICIAL] Vanguard's driver policy concerns *signed-but-vulnerable* drivers: being signed does not exempt a driver. — [/dev: Vanguard x LoL](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)
- [COMMUNITY] One OBS forum helper claims OBS's "certificate signatures" are incompatible with Vanguard (January 2025, unverified). — [OBS Forums 183334](https://obsproject.com/forum/threads/no-puedo-stremear-league-of-legends.183334/)

### Inferences
- Code-signing a user-mode recorder is good hygiene (SmartScreen, AV reputation), but it should not be expected to buy Vanguard tolerance. Vanguard's rules are behavioral: no injection, no memory access, no input, and no vulnerable drivers.
- Registering the product on the Riot Developer Portal is the compliance step Riot actually asks for.

### Gaps
- No documentation of a Vanguard-specific developer allowlist program was found.

## 7. Running League inside a VM (developer works from WSL)

### Takeaway
League with Vanguard is not supported in virtual machines (VAN 138). Riot has said it applies "heightened VM prevention" to fight bots. Build and test the recorder on a bare-metal Windows install. WSL2 on the host is a different matter: Vanguard's Security Requirements actually *require* VBS/HVCI (Hyper-V based), so the host's Hyper-V layer is not the problem. Running the game *inside* a guest VM is.

### Cited Findings
- [OFFICIAL] VAN 138 "usually means your game or Riot Vanguard is being run from a virtual machine or unsupported virtualized environment … Riot Vanguard is not supported in virtual machine environments." Fix: run on a standard Windows install. Dated 2026-07-14. — [VAN 138 (Riot Support)](https://support.riotgames.com/en-us/riot/performance/error-van-138)
- [OFFICIAL] "With heightened VM prevention, we'll drive up the cost of botting and inflict significant friction onto re-offenders." Linux is not supported, and emulation is risky because host-side cheats could manipulate the VM unseen. — [/dev: Vanguard x LoL](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)
- [OFFICIAL] Memory Integrity (HVCI/VBS, which uses the Windows hypervisor) is a Vanguard-requested security feature, and VAN: RESTRICTION: 5 fires when it fails to initialize. — [Vanguard Security Requirements](https://support.riotgames.com/en-us/riot/performance/vanguard-security-requirements); [VAN: RESTRICTION: 5](https://support.riotgames.com/en-us/riot/penalties/error-van-restriction-5)

### Inferences
- WSL2 and Hyper-V *on the gaming host* should coexist with Vanguard, since Vanguard wants VBS/HVCI on. Third-party type-1/type-2 hypervisors on the host (for example VirtualBox or VMware in legacy non-Hyper-V mode) may conflict. This is not sourced.
- Development workflow: write and build the app anywhere (including WSL), but run League plus the recorder only on bare-metal Windows. Never try to run the game in a guest to "test safely".

### Gaps
- Riot does not document whether running VMware or VirtualBox *alongside* League (not hosting it) on the same machine causes VAN errors.

---

## Draft DO / DON'T engineering rules (synthesized from the sources above; each rule cites its basis)

**DO**
1. Capture frames with Windows Graphics Capture (window or monitor) or DXGI Desktop Duplication, from your own process. Basis: community reports that window/screen capture works while Game Capture (injection) fails ([OBS 183334](https://obsproject.com/forum/threads/no-puedo-stremear-league-of-legends.183334/), [OBS 195861](https://obsproject.com/forum/threads/game-capture-black-screen-with-only-league-of-legends.195861/)).
2. Read game events only via the Live Client Data API (127.0.0.1:2999) and the LCU (lockfile, REST/WebSocket). Basis: Riot's "use the API" ([dev blog](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)).
3. Detect game start via the LCU gameflow phase or by polling 2999. Process-name or window lookup is a fallback, using at most `PROCESS_QUERY_LIMITED_INFORMATION`. This is inference, since nothing documents a threshold.
4. Register the product on the Riot Developer Portal and follow the general policies: no unfair advantage, no MMR calculators, no ads in Riot surfaces, no Brawl data, no KR rune/item push ([Riot policies](https://developer.riotgames.com/policies/general), [Overwolf LoL docs](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/league-of-legends/)).
5. Expect users' PCs to have TPM 2.0, Secure Boot, HVCI/Memory Integrity and IOMMU on. Never ask users to disable them, for example for a driver or for performance ([Security Requirements](https://support.riotgames.com/en-us/riot/performance/vanguard-security-requirements)).
6. Fail soft. If capture returns black frames, show a user-facing hint and fall back to monitor capture. Never retry with more invasive methods.
7. Test on bare-metal Windows ([VAN 138](https://support.riotgames.com/en-us/riot/performance/error-van-138)).

**DON'T**
1. Don't ship or depend on any kernel driver: no WinRing0, RTCore-style or CPU-Z-style hardware-monitor libraries for FPS/temperature overlays. Signed-but-vulnerable drivers are blocked on boot ([dev blog](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/), [VAN: Incompatible Software](https://support.riotgames.com/en-us/valorant/performance/van-incompatible-software)).
2. Don't inject DLLs into or hook League of Legends.exe or the client processes (no Present hooks, no graphics-hook-style capture). Vanguard prevents tampering with the signed League process ([dev blog](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)).
3. Don't read or write League process memory or open it with VM_READ, VM_WRITE or ALL_ACCESS. Riot will "deliberately break it as often as possible" ([dev blog](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)).
4. Don't send synthetic input to the game (SendInput or PostMessage into the League window for replay control, auto-pause or hotkeys). Input submission is detected with the process name ([dev blog](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)).
5. Don't touch registry dev overrides such as DevOverrideEnable, and don't require test-signing mode ([dev blog](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)).
6. Don't bundle or recommend debuggers, memory scanners or trainers on the gaming PC. Cheat software for other games has been "picked up" ([dev blog](https://www.leagueoflegends.com/en-us/news/dev/dev-vanguard-x-lol/)).
7. Don't route League traffic through VPNs or proxies as part of the app ([VAN: Incompatible Software](https://support.riotgames.com/en-us/valorant/performance/van-incompatible-software)).
8. Don't rely on code signing or Overwolf membership as a Vanguard exemption. Nothing documents either effect.
