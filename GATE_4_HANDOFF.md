# Gate 4 handoff: experimental link feasibility

Gate 4 is an evidence-gathering spike, not a released promise of working battles or trades. Release 0.8.3 exposes gpSP Serial-Poke only when a private `online.cfg` contains a valid `link_room`. Ordinary installs remain unchanged and link invitations and battle/trade leaderboards remain disabled.

## Implemented and proven

- The custom frontend accepts gpSP's libretro netpacket interface and selects `gpsp_serial=mul_poke` only for an explicitly configured room.
- The authenticated protocol-v2 relay assigns client 0/1, admits exactly two players, checks the `gpSP v1.0` protocol, caps payloads at 512 bytes, rate-limits each sender, keeps contents memory-only, and tears the room down when its host leaves.
- Before `netpacket_start`, each runtime flushes and fsyncs `emerald.sav`, creates a timestamped file under `link-backups/`, and retains the newest three. Backup failure aborts link startup.
- Two isolated Azahar 2126.0 instances completed four join/hard-interruption/reconnect cycles. Both started `mul_poke` eight total times and each retained exactly three backups.
- Two authenticated clients delivered 53 bounded synthetic packets through production WSS, matched the relay's packet counters, and recovered from a hard guest disconnect. Measured round trip was 164-186 ms (171 ms average) with 4.5 ms mean absolute jitter.
- Server tests cover validation, authentication, isolation, packet routing, invalid data, host loss, and legacy-client rejection.

## Not yet proven

- A checksum-valid progressed private save now passes the safe inspector, and the exact 0.8.3 3DSX loads it, authenticates through production WSS, enters its isolated link room, and remains stable in Azahar interpreter mode. This preflight still does not prove a Cable Club handshake, complete battle, complete trade, or post-trade save integrity.
- Real Cable Club traffic through public WSS still needs latency, jitter, packet-loss, and reconnect testing. The synthetic transport test proves relay delivery and reconnect only; intentionally omitting packets before transport is not evidence that the game tolerates loss.
- Physical 3DS-to-second-client battle/trade, interruption recovery, 60 FPS, and stable audio remain authoritative release gates.

Under the documented go/no-go rule, the present result is still `spike in progress`; it is not sufficient to expose public trade invitations or enable battle/trade rankings.

Release 0.8.3 passes the normal Azahar online smoke, the production-WSS link-room preflight with a validated progressed save, the connected overworld-to-wild-battle overlay regression, and all 54 automated tests against disposable PostgreSQL 16 with zero skips. The repository's `npm run prepare:link-test` command produces an ignored physical SD tree and isolated Azahar profile with a shared unpredictable room while keeping ROMs, saves, identities, preferences, and avatar assets out of the physical handoff. The v0.8.2 physical session exposed the overlay defect; v0.8.3 physical staging, installation, and recheck remain required before Cable Club acceptance. See `GATE_4_PHYSICAL_TEST.md` for the exact hashes and acceptance steps.

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

## Current release 0.8.3

- CIA: `release/emerald-online-3ds.cia` — `5dd5253ba52dd88968693096387af84a546aaf93ca15790879f324af6448cb47`
- 3DSX: `release/emerald-online-3ds.3dsx` — `732cd07521f205ee0e7da8f80f313afe454d2e32c21495bc6cea901959eac049`
- Complete first-party and corresponding gpSP source: `release/emerald-online-3ds-source-0.8.3.tar.gz` — `68f9c63dca0f05b6db7900ddcfe87475842ecd7453d8c58213eaddff9d38f030`
- Example opt-in configuration: `release/online-link-spike.example.cfg`
- Production image: `sha256:3f185c8c132cfe3481dd9ec13b2e286862a8b09a2eb654b678d0127a3c3fb1c8`
