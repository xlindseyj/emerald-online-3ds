# Gate 4 handoff: experimental link feasibility

## Current release 0.8.10

- CIA: `0dcfb25278b8adfa480754f58b61f287e7a4dbfb3b2acdb16d251ab3859a3e49`
- 3DSX: `3ac7754035725a3e8401d1e6aa9540898764b077411769d14f2107cfc0b961c9`
- Corresponding source: `be7a26d3fbc0d7bf6cef87d3451ea5b877d9bd0ca6f61f2c1c1bb7d03231a9eb`

Gate 4 is an evidence-gathering spike, not a released promise that physical battles or trades are accepted. Release 0.8.9 exposes gpSP's Emerald RFU backend only when a private `online.cfg` contains a valid `link_room`. Testers use Emerald's Wireless Club / Union Room route, not the unsupported Direct Corner path. Ordinary installs remain unchanged and link invitations and battle/trade leaderboards remain disabled.

## Implemented and proven

- The custom frontend accepts gpSP's libretro netpacket interface and selects `gpsp_serial=rfu` only for an explicitly configured room.
- The authenticated protocol-v2 relay assigns client 0/1, admits exactly two players, checks the `gpSP v1.0` protocol, caps payloads at 512 bytes, rate-limits each sender, keeps contents memory-only, and tears the room down when its host leaves.
- Before `netpacket_start`, each runtime flushes and fsyncs `emerald.sav`, creates a timestamped file under `link-backups/`, and retains the newest three. Backup failure aborts link startup.
- Two isolated Azahar 2126.0 instances completed four join/hard-interruption/reconnect cycles. Both started `mul_poke` eight total times and each retained exactly three backups.
- Two authenticated clients delivered 53 bounded synthetic packets through production WSS, matched the relay's packet counters, and recovered from a hard guest disconnect. Measured round trip was 164-186 ms (171 ms average) with 4.5 ms mean absolute jitter.
- Two isolated Azahar 2126.0 clients running v0.8.7 discovered Emerald's native avatars and Trading Board offer, exchanged CODEX's level 13 Torchic for LINZ's level 6 Marill, completed Emerald's native animation and automatic save, restarted, and loaded the exchanged parties. CODEX had two Marill and LINZ had two Torchic after restart.
- RFU packets are drained inside gpSP's wait callback and once per emulated frame during a live link. Routine host-scan transitions no longer clear discovery state; explicit withdrawal and disconnect notifications still remove peers. External online-presence overlays are suppressed on native multiplayer maps.
- The runtime teleport now writes the full `WarpData` location fields and triggers Emerald's map-reload callback sequence (`CB2_DoChangeMap` → `CB2_LoadMap2`) instead of only updating coordinates.
- Server tests cover validation, authentication, isolation, packet routing, invalid data, host loss, and legacy-client rejection.

## Not yet proven

- A two-client native Union Room battle selected two Pokémon per trainer and reached Emerald's LINZ-versus-CODEX screen on one peer, but the other peer received `Communication error... Please check all connections, then turn the power OFF and ON.` immediately after party exchange. The public relay recorded no packet-rate rejection. Battle acceptance therefore fails and remains open.
- Physical 3DS-to-second-client Union Room battle/trade, interruption recovery, post-session save comparison, public-WSS latency/loss observation, 60 FPS, stable audio, and HOME lifecycle remain authoritative release gates.
- Omitting packets in a transport harness is not evidence that Emerald's RFU session tolerates real network loss; this still requires an interactive session observation.

Under the documented go/no-go rule, the present result is still `spike in progress`; it is not sufficient to expose public trade invitations or enable battle/trade rankings.

Release 0.8.9 retains the complete two-Azahar native trade evidence and records the failed battle result above without widening the RFU claim. The repository's `npm run prepare:link-test` command creates a fresh ignored physical SD tree and isolated Azahar profile while keeping ROMs, saves, identities, preferences, and avatar assets out of the physical handoff. Physical v0.8.9 acceptance remains open; see `GATE_4_PHYSICAL_TEST.md` for the exact hashes and remaining steps.

## Physical test configuration

Use the same private room code on both clients, for example:

```ini
server=live.emeraldonline3ds.com
port=443
transport=wss
path=/game
name=Trainer
link_room=TEST-2345
```

Use a fresh unpredictable code instead of the example on the public service. Confirm both screens show `LINK <room> ACTIVE - BACKUP OK` before entering the Wireless Club / Union Room. Back up the whole SD save directory separately, then record battle/trade outcome, both post-session save hashes, restart behavior, interruption behavior, FPS, audio, packet counters, and the complete WSS diagnostic if the connection fails.

## Current release 0.8.9

- CIA: `release/emerald-online-3ds.cia` — `beed0f0b1f14c5c4b7e56745686ac8f8f2895141a3d479a829bdcb21c1b6a5ea`
- 3DSX: `release/emerald-online-3ds.3dsx` — `b325d14c7977191e5c824504a4182120d66383a7bd2cfbd5e45b77af1917825c`
- Complete first-party and corresponding gpSP source: `release/emerald-online-3ds-source-0.8.9.tar.gz` — `44fd717443216cda8fc11db827e04408e0da49e5643181ba1238c2aa9dd2ff4e`
- Example opt-in configuration: `release/online-link-spike.example.cfg`
- Production image: `sha256:152b9643f8961cc53d420d331a0a694a5be1e87a4d5f14b7683d0310a62ed419`
