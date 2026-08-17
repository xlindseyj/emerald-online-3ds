# Gate 4 handoff: experimental link feasibility

Gate 4 is an evidence-gathering spike, not a released promise that physical battles or trades are accepted. Release 0.8.7 exposes gpSP's Emerald RFU backend only when a private `online.cfg` contains a valid `link_room`. Testers use Emerald's Wireless Club / Union Room route, not the unsupported Direct Corner path. Ordinary installs remain unchanged and link invitations and battle/trade leaderboards remain disabled.

## Implemented and proven

- The custom frontend accepts gpSP's libretro netpacket interface and selects `gpsp_serial=rfu` only for an explicitly configured room.
- The authenticated protocol-v2 relay assigns client 0/1, admits exactly two players, checks the `gpSP v1.0` protocol, caps payloads at 512 bytes, rate-limits each sender, keeps contents memory-only, and tears the room down when its host leaves.
- Before `netpacket_start`, each runtime flushes and fsyncs `emerald.sav`, creates a timestamped file under `link-backups/`, and retains the newest three. Backup failure aborts link startup.
- Two isolated Azahar 2126.0 instances completed four join/hard-interruption/reconnect cycles. Both started `mul_poke` eight total times and each retained exactly three backups.
- Two authenticated clients delivered 53 bounded synthetic packets through production WSS, matched the relay's packet counters, and recovered from a hard guest disconnect. Measured round trip was 164-186 ms (171 ms average) with 4.5 ms mean absolute jitter.
- Two isolated Azahar 2126.0 clients running v0.8.7 discovered Emerald's native avatars and Trading Board offer, exchanged CODEX's level 13 Torchic for LINZ's level 6 Marill, completed Emerald's native animation and automatic save, restarted, and loaded the exchanged parties. CODEX had two Marill and LINZ had two Torchic after restart.
- RFU packets are drained inside gpSP's wait callback and once per emulated frame during a live link. Routine host-scan transitions no longer clear discovery state; explicit withdrawal and disconnect notifications still remove peers. External online-presence overlays are suppressed on native multiplayer maps.
- Server tests cover validation, authentication, isolation, packet routing, invalid data, host loss, and legacy-client rejection.

## Not yet proven

- A two-client native Union Room battle remains untested.
- Physical 3DS-to-second-client Union Room battle/trade, interruption recovery, post-session save comparison, public-WSS latency/loss observation, 60 FPS, stable audio, and HOME lifecycle remain authoritative release gates.
- Omitting packets in a transport harness is not evidence that Emerald's RFU session tolerates real network loss; this still requires an interactive session observation.

Under the documented go/no-go rule, the present result is still `spike in progress`; it is not sufficient to expose public trade invitations or enable battle/trade rankings.

Release 0.8.7 passes the normal automated suite and release audit, retains the earlier production-WSS roster/chat and physical battle-overlay evidence, and adds the complete two-Azahar native trade described above. The repository's `npm run prepare:link-test` command creates a fresh ignored physical SD tree and isolated Azahar profile while keeping ROMs, saves, identities, preferences, and avatar assets out of the physical handoff. The current production image is Ready with zero application-container restarts, all four public services are Operational, and the three live downloads match the current manifest. Physical v0.8.7 acceptance remains open; see `GATE_4_PHYSICAL_TEST.md` for the exact hashes and remaining steps.

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

## Current release 0.8.7

- CIA: `release/emerald-online-3ds.cia` — `fbbb8f99b47d9443e4d8145d5ef0dd7aef3877e11af818cb6376f4bd201171f3`
- 3DSX: `release/emerald-online-3ds.3dsx` — `66db704f409dae82078662ddb9bd189ef363bd8eff7bebc5111af2abedd82641`
- Complete first-party and corresponding gpSP source: `release/emerald-online-3ds-source-0.8.7.tar.gz` — `494877949e55693a0bfdefda5a314d4f7032e22b3961eac47b4eebcf0bcd36c8`
- Example opt-in configuration: `release/online-link-spike.example.cfg`
- Production image: `sha256:b4865ad3e7075f812a7aad303fe17c6ce1ed15f83f19e4e092a7ea24c81016f9`
