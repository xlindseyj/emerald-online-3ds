# Gate 2 handoff: paired community and defects

Gate 2 implementation, release packaging, PostgreSQL migration, production deployment, and automated/live acceptance completed on 2026-08-15. Physical Old 3DS WSS and pairing confirmation remain the release handoff test.

## Shipped

- Five-minute browser pairing approved by an authenticated 3DS, with separately hashed request tokens and credentials.
- Random 30-day idle browser sessions using `HttpOnly`, `Secure`, `SameSite=Strict` cookies and CSRF tokens.
- Public installation help, releases, service status, and confirmed/fixed defects; paired-only beta, development, feature, multiplayer, and general boards; moderator-only evidence and operations.
- Sanitized Markdown and code fences; topics, replies, edits, soft deletion, pagination, search, subscriptions, reports, locks, pins, moves, and restoration.
- Structured defect metadata and the planned defect lifecycle.
- Warnings, read-only and suspended sanctions, revocation, audit history, report-evidence redaction, and per-identity write limits.
- No attachments, direct messages, reactions, reputation, email, ROM data, saves, party data, inventory, or routine chat persistence.

## Acceptance evidence

- The normal Node suite passes 25 tests; two PostgreSQL integration tests are opt-in.
- Migration 002 and both complete durable-store lifecycles pass against disposable PostgreSQL 17.
- The release audit passes for CIA `d4b32e28b8bf79360897208a660b7f8b9e68d1255c062603890219125d7c0ced`, 3DSX `cf41213268f190603f6616c1fcb79f56790537f00a2dd4e48c334361083d68d6`, and source `0a2a1113444d5591bb6ae7bc25bf42af4c917c96321187718f23035790367806`.
- The exact 0.5.0 gpSP build passes local TCP and real production WSS enrollment in Azahar; production synthetic identities were deleted.
- CNPG backup `20260816T003821` completed before migration. The live schema records migrations 001 and 002 and exposes the expected forum, defect, and browser-session tables.
- The multi-architecture production image is pinned to `sha256:25777c10f12b629ac5eab759f9aa6f4f3f7effef5197f440baf1022041a23c7e`; both containers are ready with zero restarts.
- Public `/community`, anonymous session/categories, legal footer, 0.5.0 downloads, and hashes were checked through Cloudflare.
- A live synthetic 3DS identity approved browser pairing, created a paired-only topic and reply, returned 404 anonymously, returned 200 paired, and leaked no internal identity UUID. Its content and identity were removed; direct database verification found zero remaining synthetic rows.

## Physical acceptance

The physical console still has the earlier header-only build, which explains its continuing `E71`. When ftpd is available, preserve the existing ROM, save, state, avatar atlas, debug log, and `identity.cfg`; replace only:

- `/3ds/emerald-online-3ds/emerald-online-3ds.3dsx` with the 0.5.0 3DSX above.
- `/3ds/emerald-online-3ds/online.cfg` with the production `live.emeraldonline3ds.com:443`, WSS, `/game` configuration.
- `/cias/emerald-online-3ds.cia` with the 0.5.0 CIA above, then install it in FBI if testing the HOME Menu title.

Confirm `ONLINE`, stable reconnect identity, 45-second stationary connectivity, Wi-Fi recovery, and browser pairing. Open `/community`, start pairing, tap the trainer profile card on the bottom screen, enter the temporary code, and verify private Beta Testing content becomes available. Record the result in `TESTING.md`; never share the ROM, save, `identity.cfg`, or recovery code.
