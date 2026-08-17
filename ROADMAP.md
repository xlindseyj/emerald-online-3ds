# Roadmap

## Implemented foundation

- [x] Native dual-screen 3DS application shell
- [x] Offline/online mode switching and graceful network failure
- [x] Versioned framed protocol with hello, state, snapshot, ping, and error messages
- [x] Multi-player presence grouped by map
- [x] Server validation, connection limits, idle timeout, and health endpoint
- [x] Protocol integration tests
- [x] Private-ROM validation and ignored SD-card packaging
- [x] Actual Emerald execution through a pinned gpSP ARM dynarec core
- [x] Physical Old 3DS XL boot stability and 60 FPS frame pacing
- [x] Full-resolution 400x240 top-screen GPU presentation and 320x240 lower dashboard
- [x] Physical Old 3DS XL LAN connection and authenticated protocol handshake
- [x] Physical live Emerald map/tile bridge and server room membership
- [x] ROM-derived Brendan/May avatar pipeline and gender-aware presence protocol
- [x] Native lower-screen runtime panel and live map/tile RAM bridge
- [x] Nonblocking presence connection integrated into actual Emerald execution
- [x] Automated Azahar-to-server connection smoke test
- [x] Same-map remote trainer markers composited over the Emerald framebuffer
- [x] Rate-limited same-map chat with native 3DS touch keyboard
- [x] Direction-aware trainer presence with smooth position interpolation
- [x] Fail-closed operator test peers that stay on the exact observed starting tile and never invent or infer synthetic movement
- [x] Runtime decoding of private-ROM trainer OBJ graphics with transparent overlay
- [x] Stationary-player keepalive, automatic reconnect, and state republish after transient drops
- [x] Native lower-screen party summary with live nickname, level, and HP data
- [x] Local-only bottom-screen Bag browser with pocket tabs, decrypted quantities, money, and private-ROM item names
- [x] Bottom-screen Map/Radar with current coordinates, facing, movement trail, and same-map remote trainer markers
- [x] Allowlisted, rate-limited same-map touch emotes with transient overworld indicators
- [x] Server-issued protocol-v2 device credentials, one-time recovery, export, revocation, deletion, stable opaque IDs, and duplicate-session replacement
- [x] Two-instance CNPG PostgreSQL with Longhorn, TLS, External Secrets, migrations, retention cleanup, and encrypted scheduled MinIO backups
- [x] Production Cloudflare routes for `emeraldonline3ds.com` and `wss://live.emeraldonline3ds.com/game`
- [x] Idempotent official release forum publishing with structured notes, checksums, safe same-origin media, historical backfill, and deployment gating
- [x] Original HOME Menu icon/banner and full-resolution emerald-themed dual-screen presentation
- [x] Hardware-oriented sparse OAM capture, 10 Hz network polling, retained lower UI, and direct one-pass top rendering
- [x] Non-root container, Kubernetes TCP load-balancer manifest, health probes, resource limits, and graceful shutdown
- [x] DNS hostname support in the 3DS runtime for durable public endpoints

## Required for the full objective

- [x] Faithful local overworld/battle/save execution through private-ROM emulation
- [x] Local battle, party, inventory, progression, save, and audio through gpSP
- [x] Bottom-screen production UI expansion (party, bag, map/radar, chat, emotes, profiles, and privacy controls)
- [x] Remote trainer rendering foundation, interpolation, emotes, and rate-limited map chat
- [ ] Link battles/trades (transport, reconnect, safe backups, and a complete native two-Azahar Union Room trade through save/restart pass; a two-client battle plus physical 3DS battle/trade/interruption/save/audio/performance acceptance are still required before invitations are exposed)
- [x] Browser pairing, paired forum authorization, defect reports, sanctions, moderation UI, device identity, PostgreSQL, and TLS
- [x] Add privacy-safe Prometheus service metrics, an authenticated Grafana dashboard, and bounded concurrent load tests
- [ ] Add a MinIO KMS; the NAT-friendly Kubernetes deployment, persistence, tested compressed backups, and connection/rate limits are operating, but backup encryption at rest is not yet claimed
- [ ] Confirm May plus authentic avatars in a physical two-client test, test New 3DS, and finalize release packaging (Brendan is confirmed on Old 3DS XL with a synthetic peer)
- [ ] Integrate remote-avatar compositing with Emerald's foreground/object priority, or derive a local-only occlusion mask from the user's validated ROM, so a trainer on a valid tile passes behind signs and tree canopies instead of being drawn over them. Do not upload or package ROM-derived map data.
- [ ] Extend presence with validated locomotion/elevation state (walking, cycling, surfing, diving, and relevant object priority) before allowing operator-spawned peers to move. Until then, movement acceptance must use a real second client; coordinates alone are not sufficient to distinguish visually valid land, water, elevation, and occlusion behavior.
- [ ] Add a reusable, versioned online-NPC definition system. Its first character is a scientist at map `0-9`, tile `14,13`, facing south, rendered from an allowlisted sprite decoded only from the user's validated official ROM. The scientist exists only while authenticated and connected to the online server and welcomes the player with `Welcome to Emerald Online 3DS - Beta!`. Prefer a short overhead greeting when it is readable and non-blocking; otherwise show the same message when the player talks to the scientist. Before release, verify the tile is walkable, the overlay does not replace or block a ROM NPC, warp, collision, or story event, disconnect removes it immediately, reconnect restores it, and no ROM-derived sprite data is uploaded, stored server-side, or included in public artifacts.

The networking protocol should evolve additively with explicit version negotiation. Never upload ROM-derived content to the server.
