# Gate 3 handoff: profiles, consent, and leaderboards

Gate 3 implementation, release packaging, PostgreSQL migration, production deployment, and automated/live acceptance completed on 2026-08-15. Physical Old 3DS WSS and bottom-screen confirmation remain the release handoff test.

## Shipped

- A third lower-screen Player Stats page reached with `Y`, alongside Online and local-only Party pages.
- Uploads off by default; typing `YES` explicitly enables Seen, Caught, Badges, and Battle Frontier streaks after all four fields are named.
- Independent field toggles, one-minute refresh, manual sync, atomic private `stats.cfg`, typed `DELETE`, and browser identity-wide deletion.
- Per-release, paginated Pokédex, badge, Frontier facility/mode/level, and beta compatibility boards.
- `Community-submitted`, `Server-observed`, `Peer-confirmed`, and `Under review` terminology. A quarantined jump does not replace the last accepted score and does not sanction the player.
- Moderator anomaly review with self-review prevention and an audit record.
- Battle and trade boards are present but intentionally disabled until both-client completion detection passes physical testing.
- No Trainer ID, Pokémon, party, moves, inventory, save data, ROM content, chat-volume, forum-post, report, or raw-online-time ranking.

## Acceptance evidence

- All 33 Node tests pass against disposable PostgreSQL 17 with migrations 001-003.
- The ARMv6K 3DSX and CIA compile with the pinned devkitARM container. The private SD package contains the exact release 3DSX and production WSS configuration.
- Azahar 2126.0 passes local enrollment, stable reconnect, stationary keepalive, state/chat/emote injection, and production WSS enrollment after deployment; synthetic identities were deleted.
- CNPG backup `emerald-pg-gate3-20260816t0115z` completed before migration 003.
- Production image `sha256:5ed47c0c724dec6569e5b263476dbe83e947b270dc4554a5c5967fc90fdd6110` is multi-architecture and immutable. Both containers are ready with zero restarts.
- The complete live Gate 3 lifecycle passed through Cloudflare, followed by direct database confirmation of zero synthetic identities, leaderboard rows, snapshot history, or compatibility reports.
- Live CIA, 3DSX, and source downloads exactly match the hashes below.

## Release 0.6.1

- CIA: `release/emerald-online-3ds.cia` — `2050e8c42e49f952a5489afefa6c6c2059a2046fb809423a9ffa280ee5ce1e92`
- 3DSX: `release/emerald-online-3ds.3dsx` — `92d315f50d2e8a7ce93d9407f4cbe6eb465bf848d484cc39a0263fdcb3914f18`
- Corresponding source: `release/emerald-online-3ds-source-0.6.1.tar.gz` — `2b6ac88b17a29679c96b8ae927d0803cdc1c46455835b36327e51c88dd973ada`

## Physical acceptance

The latest physical attempt still reported E71 before any application-protocol connection reached production. Because ftpd was not listening, the installed artifact and `gpsp-debug.log` could not be verified. Release 0.6.1 therefore prints `v0.6.1` plus `E`, stage, TLS result, verification flags, and accepted future skew directly on the bottom screen, and its CIA metadata is correctly stamped 0.6.1. When ftpd is available, preserve the ROM, save, state, avatar atlas, debug log, `identity.cfg`, and any existing `stats.cfg`; replace only the 3DSX and production `online.cfg`, plus copy the CIA and reinstall it through FBI if testing the HOME Menu title.

First confirm the screen says `v0.6.1`. If E71 remains, record the complete line in the form `E71 S3 TLS-9984 V00000200 F0` and verify the console date and time. Then confirm WSS reaches `ONLINE` and perform steps 6-15 in `TESTING.md`. In particular, prove default-off consent, cancellation, field toggles, server/profile visibility, deletion, persistence, and stable 60 FPS on the Old 3DS XL. Never share the ROM, save, identity token, recovery code, or private avatar atlas.
