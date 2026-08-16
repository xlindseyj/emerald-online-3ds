# Gate 4 handoff: experimental link feasibility

Gate 4 is an evidence-gathering spike, not a released promise of working battles or trades. Release 0.8.4 exposes gpSP Serial-Poke only when a private `online.cfg` contains a valid `link_room`. Ordinary installs remain unchanged and link invitations and battle/trade leaderboards remain disabled.

## Implemented and proven

- The custom frontend accepts gpSP's libretro netpacket interface and selects `gpsp_serial=mul_poke` only for an explicitly configured room.
- The authenticated protocol-v2 relay assigns client 0/1, admits exactly two players, checks the `gpSP v1.0` protocol, caps payloads at 512 bytes, rate-limits each sender, keeps contents memory-only, and tears the room down when its host leaves.
- Before `netpacket_start`, each runtime flushes and fsyncs `emerald.sav`, creates a timestamped file under `link-backups/`, and retains the newest three. Backup failure aborts link startup.
- Two isolated Azahar 2126.0 instances completed four join/hard-interruption/reconnect cycles. Both started `mul_poke` eight total times and each retained exactly three backups.
- Two authenticated clients delivered 53 bounded synthetic packets through production WSS, matched the relay's packet counters, and recovered from a hard guest disconnect. Measured round trip was 164-186 ms (171 ms average) with 4.5 ms mean absolute jitter.
- Server tests cover validation, authentication, isolation, packet routing, invalid data, host loss, and legacy-client rejection.

## Not yet proven

- Checksum-valid progressed physical and Azahar saves pass the safe inspector. The exact v0.8.4 3DSX is installed on the physical Old 3DS and loaded in a separately cloned Azahar profile; both authenticate through production WSS and use the same private room. The v0.8.4 Azahar peer currently hosts the recreated room while the physical client awaits one Online off/on reconnect. This preflight still does not prove a Cable Club handshake, complete battle, complete trade, or post-trade save integrity.
- Real Cable Club traffic through public WSS still needs latency, jitter, packet-loss, and reconnect testing. The synthetic transport test proves relay delivery and reconnect only; intentionally omitting packets before transport is not evidence that the game tolerates loss.
- Physical 3DS-to-second-client battle/trade, interruption recovery, 60 FPS, and stable audio remain authoritative release gates.

Under the documented go/no-go rule, the present result is still `spike in progress`; it is not sufficient to expose public trade invitations or enable battle/trade rankings.

Release 0.8.4 passes the normal Azahar online smoke, production-WSS roster/chat checks, the earlier link-room preflight with a validated progressed save, the connected overworld-to-wild-battle overlay regression, the corresponding physical battle-overlay recheck with a same-map production peer, and all 60 automated tests against disposable PostgreSQL 16 with zero skips. The repository's `npm run prepare:link-test` command produced a fresh ignored v0.8.4 physical SD tree and isolated Azahar profile using the already-configured private room while keeping ROMs, saves, identities, preferences, and avatar assets out of the physical handoff. The v0.8.4 physical artifacts are installed and hash-verified with a v0.8.3 rollback binary; the overlay defect is closed, but Cable Club battle/trade/save/interruption/performance acceptance remains required. See `GATE_4_PHYSICAL_TEST.md` for the exact hashes and acceptance steps.

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

Use a fresh unpredictable code instead of the example on the public service. Confirm both screens show `LINK <room> ACTIVE - BACKUP OK` before entering the Cable Club. Back up the whole SD save directory separately, then record battle/trade outcome, both post-session save hashes, restart behavior, interruption behavior, FPS, audio, packet counters, and the complete WSS diagnostic if the connection fails.

## Current release 0.8.4

- CIA: `release/emerald-online-3ds.cia` — `225f021371b3cb3788c0879c2d8fce0d759d9847eee1ecd4f4461b054005d82c`
- 3DSX: `release/emerald-online-3ds.3dsx` — `71007c45b922463cf1181ca42ae73b1d08ab681cb28c7ad7a2799cab21308ba0`
- Complete first-party and corresponding gpSP source: `release/emerald-online-3ds-source-0.8.4.tar.gz` — `d27be10b3d11c4d198ad7679c3f3b57441705dcd258dffbd5231ca76d32dc658`
- Example opt-in configuration: `release/online-link-spike.example.cfg`
- Production image: `sha256:b0b501e92a3a106fc29eeedd6a5c8829ae3c3fa1d801e22416e22393b9f26668`
