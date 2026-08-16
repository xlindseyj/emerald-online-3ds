# Gate 4 handoff: experimental link feasibility

Gate 4 is an evidence-gathering spike, not a released promise of working battles or trades. Release 0.8.2 exposes gpSP Serial-Poke only when a private `online.cfg` contains a valid `link_room`. Ordinary installs remain unchanged and link invitations and battle/trade leaderboards remain disabled.

## Implemented and proven

- The custom frontend accepts gpSP's libretro netpacket interface and selects `gpsp_serial=mul_poke` only for an explicitly configured room.
- The authenticated protocol-v2 relay assigns client 0/1, admits exactly two players, checks the `gpSP v1.0` protocol, caps payloads at 512 bytes, rate-limits each sender, keeps contents memory-only, and tears the room down when its host leaves.
- Before `netpacket_start`, each runtime flushes and fsyncs `emerald.sav`, creates a timestamped file under `link-backups/`, and retains the newest three. Backup failure aborts link startup.
- Two isolated Azahar 2126.0 instances completed four join/hard-interruption/reconnect cycles. Both started `mul_poke` eight total times and each retained exactly three backups.
- Two authenticated clients delivered 53 bounded synthetic packets through production WSS, matched the relay's packet counters, and recovered from a hard guest disconnect. Measured round trip was 164-186 ms (171 ms average) with 4.5 ms mean absolute jitter.
- Server tests cover validation, authentication, isolation, packet routing, invalid data, host loss, and legacy-client rejection.

## Not yet proven

- A checksum-valid progressed private save now passes the safe inspector, and the exact 0.8.2 3DSX loads it, authenticates through production WSS, enters its isolated link room, and remains stable in Azahar interpreter mode. This preflight still does not prove a Cable Club handshake, complete battle, complete trade, or post-trade save integrity.
- Real Cable Club traffic through public WSS still needs latency, jitter, packet-loss, and reconnect testing. The synthetic transport test proves relay delivery and reconnect only; intentionally omitting packets before transport is not evidence that the game tolerates loss.
- Physical 3DS-to-second-client battle/trade, interruption recovery, 60 FPS, and stable audio remain authoritative release gates.

Under the documented go/no-go rule, the present result is still `spike in progress`; it is not sufficient to expose public trade invitations or enable battle/trade rankings.

Release 0.8.2 passes the normal Azahar online smoke, the production-WSS link-room preflight with a validated progressed save, and all 53 automated tests against disposable PostgreSQL 16 with zero skips. The repository's `npm run prepare:link-test` command produces an ignored physical SD tree and isolated Azahar profile with a shared unpredictable room while keeping ROMs, saves, identities, preferences, and avatar assets out of the physical handoff. The matching 0.8.2 3DSX, CIA, and room configuration are staged and hash-verified on the physical SD card, with the prior files backed up. The 3DSX is ready in Homebrew Launcher; the staged CIA must still be installed through FBI before the HOME Menu title is current. See `GATE_4_PHYSICAL_TEST.md` for the exact hashes and acceptance steps.

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

## Current release 0.8.2

- CIA: `release/emerald-online-3ds.cia` — `28b27c96227fae1c596e85b711787d56597b6a7b2063c74cb0378109e3b85ac0`
- 3DSX: `release/emerald-online-3ds.3dsx` — `e58b33b02f5b9119596c19ada1870276c1fa2dd80594c68933d43f6a5a132abc`
- Complete first-party and corresponding gpSP source: `release/emerald-online-3ds-source-0.8.2.tar.gz` — `1036e7008ecf1f5a5b128e98d1b08fac1e52cf04394c0e662d4588ae7b568ebb`
- Example opt-in configuration: `release/online-link-spike.example.cfg`
- Production image: `sha256:f6970d835868a01b92126a04cba42a8a582cd758c0410fb0c0041d2ccf72fa5b`
