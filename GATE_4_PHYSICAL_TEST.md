# Gate 4 physical and Azahar test handoff

Gate 4 remains an experimental feasibility test. Public battle/trade invitations and rankings stay disabled until a real Cable Club battle, trade, save comparison, interruption test, and Old 3DS performance test pass.

## Current artifacts

- Release: `0.8.1`
- CIA SHA-256: `012da4236b2018d5e64faefcfedfe786fe207d0b925cf714cf755c534e385c37`
- 3DSX SHA-256: `33cf8ccda02205ab352b08811ae059cf86b81794c0101481788dc8d49d083b80`
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

The tool accepts only a 128 KiB Emerald save (or a 128 KiB save with a 512-byte emulator footer), creates a fresh unpredictable room, refuses output outside `generated/`, and refuses to overwrite a previous bundle. It copies private ROM/save data only into the ignored Azahar profile, never into `physical-sd/` or a public release.

## Physical copy and test

1. Preserve independent copies of the physical and emulator saves.
2. Copy `physical-sd/3ds/emerald-online-3ds/emerald-online-3ds.3dsx` and `online.cfg` to the matching SD directory. Do not replace `identity.cfg`, `stats.cfg`, the ROM, save, or avatar atlas.
3. Optionally copy the CIA from `physical-sd/cias/` and reinstall it with FBI; merely copying a CIA does not update the installed HOME Menu title.
4. Start the physical runtime and the prepared Azahar profile. Confirm both show `LINK <room> ACTIVE - BACKUP OK` before entering the Cable Club.
5. Complete one battle and one trade through public WSS. Record FPS/audio, packet counters, both save hashes after clean exit and restart, and the result of interrupting one later session.
6. If either save differs unexpectedly, stop testing and restore the independent backups. Do not proceed to Gate 5.

## Evidence carried forward from 0.8.0

- All 45 automated tests passed with migrations 001-005 against disposable PostgreSQL 16; no tests were skipped.
- Normal Azahar online smoke passed identity persistence, reconnect, state republish, movement, chat, and all four emotes.
- Two Azahar instances passed four startup/hard-interruption cycles, started eight netpacket sessions, and retained the newest three backups per profile.
- A fresh production-WSS synthetic run delivered 53 packets, recovered the guest, measured 173.6-200.9 ms round trip with 5.6 ms mean absolute jitter, and deleted both synthetic identities.
- Both emulator profiles still emitted zero Cable Club packets because no progressed private save is available in the workspace. This is transport and backup evidence only, not battle/trade acceptance.
