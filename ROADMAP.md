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
- [x] Runtime decoding of private-ROM trainer OBJ graphics with transparent overlay
- [x] Stationary-player keepalive, automatic reconnect, and state republish after transient drops
- [x] Native lower-screen party summary with live nickname, level, and HP data
- [x] Allowlisted, rate-limited same-map touch emotes with transient overworld indicators
- [x] Server-issued protocol-v2 device credentials, one-time recovery, export, revocation, deletion, stable opaque IDs, and duplicate-session replacement
- [x] Two-instance CNPG PostgreSQL with Longhorn, TLS, External Secrets, migrations, retention cleanup, and encrypted scheduled MinIO backups
- [x] Production Cloudflare routes for `emeraldonline3ds.com` and `wss://live.emeraldonline3ds.com/game`
- [x] Original HOME Menu icon/banner and full-resolution emerald-themed dual-screen presentation
- [x] Hardware-oriented sparse OAM capture, 10 Hz network polling, retained lower UI, and direct one-pass top rendering
- [x] Non-root container, Kubernetes TCP load-balancer manifest, health probes, resource limits, and graceful shutdown
- [x] DNS hostname support in the 3DS runtime for durable public endpoints

## Required for the full objective

- [x] Faithful local overworld/battle/save execution through private-ROM emulation
- [x] Local battle, party, inventory, progression, save, and audio through gpSP
- [ ] Bottom-screen production UI expansion (bag and map; party, chat, and emotes are implemented)
- [x] Remote trainer rendering foundation, interpolation, emotes, and rate-limited map chat
- [ ] Link battles/trades (feasibility spike must pass before invitations are exposed); durable device authentication is implemented
- [ ] Browser pairing, forum authorization, reports, sanctions, and moderation UI; device identity, PostgreSQL, and TLS are implemented
- [ ] Add service dashboards, load tests, and a MinIO KMS; the NAT-friendly Kubernetes deployment, persistence, tested compressed backups, and connection/rate limits are operating, but backup encryption at rest is not yet claimed
- [ ] Confirm May plus authentic avatars in a physical two-client test, test New 3DS, and finalize release packaging (Brendan is confirmed on Old 3DS XL with a synthetic peer)

The networking protocol should evolve additively with explicit version negotiation. Never upload ROM-derived content to the server.
