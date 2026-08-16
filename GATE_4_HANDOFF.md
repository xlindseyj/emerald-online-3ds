# Gate 4 handoff: experimental link feasibility

Gate 4 is an evidence-gathering spike, not a released promise of working battles or trades. Release 0.7.0 exposes gpSP Serial-Poke only when a private `online.cfg` contains a valid `link_room`. Ordinary installs remain unchanged and link invitations and battle/trade leaderboards remain disabled.

## Implemented and proven

- The custom frontend accepts gpSP's libretro netpacket interface and selects `gpsp_serial=mul_poke` only for an explicitly configured room.
- The authenticated protocol-v2 relay assigns client 0/1, admits exactly two players, checks the `gpSP v1.0` protocol, caps payloads at 512 bytes, rate-limits each sender, keeps contents memory-only, and tears the room down when its host leaves.
- Before `netpacket_start`, each runtime flushes and fsyncs `emerald.sav`, creates a timestamped file under `link-backups/`, and retains the newest three. Backup failure aborts link startup.
- Two isolated Azahar 2126.0 instances completed four join/hard-interruption/reconnect cycles. Both started `mul_poke` eight total times and each retained exactly three backups.
- Two authenticated clients delivered 53 bounded synthetic packets through production WSS, matched the relay's packet counters, and recovered from a hard guest disconnect. Measured round trip was 164-186 ms (171 ms average) with 4.5 ms mean absolute jitter.
- Server tests cover validation, authentication, isolation, packet routing, invalid data, host loss, and legacy-client rejection.

## Not yet proven

- The available emulator state starts at the title screen and emitted zero Cable Club packets. A LAN Cable Club handshake, complete battle, complete trade, and post-trade save comparison are therefore not yet accepted.
- Real Cable Club traffic through public WSS still needs latency, jitter, packet-loss, and reconnect testing. The synthetic transport test proves relay delivery and reconnect only; intentionally omitting packets before transport is not evidence that the game tolerates loss.
- Physical 3DS-to-second-client battle/trade, interruption recovery, 60 FPS, and stable audio remain authoritative release gates.

Under the documented go/no-go rule, the present result is still `spike in progress`; it is not sufficient to expose public trade invitations or enable battle/trade rankings.

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

## Release 0.7.0

- CIA: `release/emerald-online-3ds.cia` — `a40799ebd3df8fae7f3a8661d4a8b509a1c997a07bb6569a0915966bcec17269`
- 3DSX: `release/emerald-online-3ds.3dsx` — `520f8d28ce2e78f650e0a9371b07b855a4d8e00096b51273e082cca734b96f6d`
- Complete first-party and corresponding gpSP source: `release/emerald-online-3ds-source-0.7.0.tar.gz` — `1c6028deaa191562d2f798c10effdd16f9a1ef8a649f5e16bb8c83088f2f6ccf`
- Example opt-in configuration: `release/online-link-spike.example.cfg`
- Production image: `sha256:a2fdab5ee2451d88ad6bf6f6810260b63f33a0ec01170d94ba4a94b27fbc8617`
