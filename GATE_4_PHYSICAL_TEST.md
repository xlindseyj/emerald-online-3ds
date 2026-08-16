# Gate 4 physical and Azahar test handoff

Gate 4 remains an experimental feasibility test. Public battle/trade invitations and rankings stay disabled until a real Cable Club battle, trade, save comparison, interruption test, and Old 3DS performance test pass.

## Current artifacts

- Release: `0.8.3`
- CIA SHA-256: `5dd5253ba52dd88968693096387af84a546aaf93ca15790879f324af6448cb47`
- 3DSX SHA-256: `732cd07521f205ee0e7da8f80f313afe454d2e32c21495bc6cea901959eac049`
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
5. Complete one battle and one trade through public WSS. Record FPS/audio, packet counters, both save hashes after clean exit and restart, and the result of interrupting one later session.
6. If either save differs unexpectedly, stop testing and restore the independent backups. Do not proceed to Gate 5.

## Current 0.8.3 preflight evidence

- The physical save has two complete checksum-valid slots. Its active slot has 49 minutes played, one party member, and a Route 102 position, which is sufficient to walk to Oldale's Cable Club. These facts contain no Trainer ID, Pokémon, inventory, ROM, or save bytes.
- The exact release 3DSX loaded that save in Azahar 2126.0, authenticated through production WSS, entered its isolated link room, and remained alive beyond the former crash point at about 29 FPS in interpreter mode.
- The interpreter no longer initializes unmapped 3DS translation caches, and nonblocking peer polling supplies the address-family metadata Azahar requires.
- A production-WSS peer was visibly present beside the Azahar player in the overworld, absent throughout a real wild battle while still connected, and visible again after fleeing. This verifies the v0.8.3 overworld callback and battle-flag guard in Azahar.
- All 54 automated tests passed against disposable PostgreSQL 16 with zero skips. Normal local-TCP and production-WSS Azahar smokes also passed, and every synthetic production identity was deleted.
- The v0.8.2 physical run exposed the remote-overlay-in-battle defect and was stopped before Cable Club acceptance. v0.8.3 must be staged, installed, hash-verified, and physically rechecked before the remaining battle/trade work.
- The copied 3DSX is ready to launch from Homebrew Launcher after staging. A staged CIA does not replace the installed HOME Menu title until it is selected in FBI and installed.

## Earlier transport evidence

- All 45 automated tests passed with migrations 001-005 against disposable PostgreSQL 16; no tests were skipped.
- Normal Azahar online smoke passed identity persistence, reconnect, state republish, movement, chat, and all four emotes.
- Two Azahar instances passed four startup/hard-interruption cycles, started eight netpacket sessions, and retained the newest three backups per profile.
- A fresh production-WSS synthetic run delivered 53 packets, recovered the guest, measured 173.6-200.9 ms round trip with 5.6 ms mean absolute jitter, and deleted both synthetic identities.
- Those earlier emulator profiles emitted zero Cable Club packets because their saves had not reached the Cable Club. That historical result remains transport and backup evidence only, not battle/trade acceptance.
