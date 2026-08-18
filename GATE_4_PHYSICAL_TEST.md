# Gate 4 physical and Azahar test handoff

Gate 4 remains an experimental feasibility test. Version 0.8.8 retains the completed native two-Azahar Union Room trade evidence, but a two-Azahar battle failed after party exchange and public battle/trade invitations and rankings stay disabled until a physical 3DS-to-second-client Union Room battle, trade, save comparison, interruption test, and Old 3DS performance/audio test pass.

## Current artifacts

- Release: `0.8.8`
- CIA SHA-256: `306f61284659c6082f20b534e30fd16b650fb6cd162d85497be695037e038d5d`
- 3DSX SHA-256: `7f982cc50935dc73bf447a59327bf74d60835ca33480ae9dfc9362e184df3a87`
- Corresponding-source SHA-256: `c988a406ab90d84a86b8974a38c13757f36ed960c17ee628c0c6cd3ba2992da3`
- Azahar: official 2126.0 AppImage under the ignored `.tools/azahar/` directory

Create a fresh ignored bundle for each session. Its `physical-sd/` tree contains only the current release CIA, 3DSX, and production-WSS `online.cfg`. It intentionally contains no ROM, save, avatar atlas, device identity, or statistics preference.

## Recreate a safe bundle

Run:

```sh
npm run prepare:link-test
```

To prepare the isolated Azahar peer with a private progressed save:

```sh
npm run prepare:link-test -- --save /private/path/emerald.sav
```

The tool accepts only a 128 KiB Emerald save (or a 128 KiB save with a 512-byte emulator footer), validates the Emerald sector signatures, section IDs, checksums, counters, active slot, party, time, and position, and refuses a save that is not progressed enough for the Cable Club. It creates a fresh unpredictable room, refuses output outside `generated/`, and refuses to overwrite a previous bundle. It copies private ROM/save data only into the ignored Azahar profile, never into `physical-sd/` or a public release. The Azahar profile explicitly disables gpSP's hardware-only dynarec; the physical profile retains it.

## Physical copy and test

1. Preserve independent copies of the physical and emulator saves.
2. Copy `physical-sd/3ds/emerald-online-3ds/emerald-online-3ds.3dsx` and `online.cfg` to the matching SD directory. Do not replace `identity.cfg`, `stats.cfg`, the ROM, save, or avatar atlas.
3. Optionally copy the CIA from `physical-sd/cias/` and reinstall it with FBI; merely copying a CIA does not update the installed HOME Menu title.
4. Start the physical runtime and the prepared Azahar profile. Confirm both show `LINK <room> ACTIVE - BACKUP OK` before entering the Cable Club.
5. Use the Wireless Club / Union Room, not the Direct Corner attendants. Complete one battle and one trade through public WSS. Record FPS/audio, packet counters, both save hashes after clean exit and restart, and the result of interrupting one later session.
6. If either save differs unexpectedly, stop testing and restore the independent backups. Do not proceed to Gate 5.

## Current 0.8.8 evidence

- Two isolated Azahar 2126.0 clients completed a native Union Room trade. CODEX offered a level 13 Torchic for a Water-type Pokémon and LINZ sent a level 6 Marill. Both native avatars, the Trading Board offer, request, animation, automatic save, restart, and exchanged parties were confirmed. CODEX loaded two Marill and LINZ loaded two Torchic after restart.
- The v0.8.7 runtime uses gpSP's RFU backend for explicitly configured rooms, drains packets during gpSP's tight wait windows, preserves temporary host scans, removes explicitly withdrawn/disconnected peers, and suppresses external overlays on native multiplayer maps.
- The current public CIA, 3DSX, and source downloads match the hashes above. Production image `sha256:390b6d6e1cad67d502af9a5b5cc01c52e3c32e851f0f1ff6e3237903fe6c9d12` is Ready with zero application-container restarts; the public health endpoint is database-ready and all four public status checks are Operational.
- A current two-Azahar battle selected both two-Pokémon teams; LINZ reached the native VS screen while CODEX received Emerald's communication error. Physical v0.8.8 battle/trade, interrupted-session recovery, save comparison, current FPS, audio, and HOME lifecycle remain unrecorded. Gate 5 must not begin yet.

## Historical 0.8.4 physical preflight evidence

- Before v0.8.4 transfer, the physical save backup had two complete checksum-valid slots, 106 minutes played, two party members, and a valid map position. The runtime, CIA, and on-device v0.8.3 rollback binary were re-downloaded and hash-verified; ROM, save, save state, identity, configuration, statistics preferences, avatar atlas, and diagnostics remained byte-for-byte unchanged.
- The physical v0.8.4 CIA was installed and reconnected through production WSS. The user confirmed Global Online Users, coordinates, read-only rows, and multi-page touch navigation on the Old 3DS. Map Chat, current FPS, audio, and HOME lifecycle remain to be recorded.
- A fresh ignored `generated/gate4-cable-session-v084` bundle uses the same private room already configured on the physical console. Its physical handoff contains only the exact v0.8.4 CIA, 3DSX, and `online.cfg`; it excludes ROM, save, identity, preferences, and avatar data.
- The isolated v0.8.4 Azahar profile contains an independently copied checksum-valid progressed save with two valid slots, 68 minutes, one party member, and map `0-17`. Its save hash matches the preserved source copy. The previous v0.8.3 Azahar process and its orphaned AppImage child were stopped only after this clone was verified.
- The v0.8.4 Azahar client authenticated through production WSS and is the sole host waiting in the private room. The physical client must toggle Online off/on once to rejoin; both clients must then report `ACTIVE - BACKUP OK` before Cable Club navigation begins.
- All 60 tests pass with zero skips after migrations 001-006 against disposable PostgreSQL 16. The public build, release audit, production deployment, and live WSS global-roster/chat-timestamp checks also pass.
- The interpreter no longer initializes unmapped 3DS translation caches, and nonblocking peer polling supplies the address-family metadata Azahar requires.
- A production-WSS peer was visibly present beside the Azahar player in the overworld, absent throughout a real wild battle while still connected, and visible again after fleeing. This verifies the v0.8.3 overworld callback and battle-flag guard in Azahar.
- For the historical v0.8.3 hotfix, all 54 automated tests passed against disposable PostgreSQL 16 with zero skips. Normal local-TCP and production-WSS Azahar smokes also passed, and every synthetic production identity was deleted.
- The v0.8.2 physical run exposed the remote-overlay-in-battle defect and was stopped before Cable Club acceptance. The v0.8.3 hotfix was staged and re-downloaded from the SD card with its exact historical hashes; v0.8.4 retains that guard and has its own verified v0.8.3 rollback copy.
- With v0.8.3 online on the physical 3DS and a temporary production peer connected on the same map, the user entered a battle and confirmed the remote-trainer hiding fix worked. The test peer was disconnected immediately afterward. This closes the physical regression for the v0.8.2 overlay defect; it does not close the remaining Cable Club battle, trade, save-integrity, interruption, performance, or audio gates.

## Earlier transport evidence

- All 45 automated tests passed with migrations 001-005 against disposable PostgreSQL 16; no tests were skipped.
- Normal Azahar online smoke passed identity persistence, reconnect, state republish, movement, chat, and all four emotes.
- Two Azahar instances passed four startup/hard-interruption cycles, started eight netpacket sessions, and retained the newest three backups per profile.
- A fresh production-WSS synthetic run delivered 53 packets, recovered the guest, measured 173.6-200.9 ms round trip with 5.6 ms mean absolute jitter, and deleted both synthetic identities.
- Those earlier emulator profiles emitted zero Cable Club packets because their saves had not reached the Cable Club. That historical result remains transport and backup evidence only, not battle/trade acceptance.
