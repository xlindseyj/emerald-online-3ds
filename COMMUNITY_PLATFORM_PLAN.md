# Staged Emerald Online Community Plan

## Summary

Proceed with the database, leaderboards, forum, defects, contextual 3DS hub, and link multiplayer—but release them through independent gates.

The revised plan avoids three major risks:

- A failed experimental link implementation cannot delay the community platform.
- Pairing failures cannot lock users out of essential support.
- The first forum release excludes file uploads and other high-risk features.

## Execution status

- Gate 0: complete and published to the LindseyWebSolutions Gitea organization.
- Gate 1: implementation and automated/live acceptance complete on 2026-08-15. Physical WSS exposed both header-capitalization and 3DS-local-clock certificate-validation issues. The exact clock-skew fix passes production WSS in Azahar; copying it and confirming WSS/SD identity on hardware remain the final handoff test.
- Gate 2: implementation, PostgreSQL migration, public deployment, release packaging, and automated/live acceptance complete on 2026-08-15. Physical WSS and browser-pairing acceptance remain pending transfer of the current build.
- Gate 3: implementation, migration 003, 0.6.1 packaging, production deployment, PostgreSQL lifecycle tests, live synthetic lifecycle, and Azahar production-WSS acceptance complete on 2026-08-15. The 0.6.1 hotfix exposes its version and full TLS diagnostic on-screen and fixes the CIA metadata version. Bottom-screen consent/stat rendering and WSS remain pending confirmation on the physical Old 3DS XL.
- Gate 4: feasibility transport implemented for release 0.7.0. gpSP `mul_poke`, the libretro netpacket callbacks, bounded two-player relay rooms, strict opt-in configuration, hard-interruption reconnect, and newest-three timestamped save backups pass unit and two-instance Azahar startup tests. A two-client production-WSS relay test delivered 53 bounded synthetic packets, matched server counters, and recovered from a hard guest disconnect at 171 ms average round trip and 4.5 ms mean absolute jitter. No Cable Club packet was emitted from the available title-screen test state, so battle, trade, save integrity, real Cable Club loss tolerance, and physical performance acceptance remain open. The go/no-go decision has not been made and public invitations/rankings remain disabled.
- Gate 5: not started and gated on Gate 4's physical go/no-go result.

## Gate 0: Repository, Build, and Licensing

- Move the Git worktree to the project root and capture all first-party source.
- Preserve the exact modified gpSP source as a pinned fork/submodule or reproducible patch set.
- Publish the corresponding source, license, build scripts, and exact source revision beside every CIA release. Treat this as a release gate because the frontend is statically linked with GPL-covered gpSP.
- Remove unused third-party checkouts and keep ROM-derived/reference game content outside the tracked repository.
- Require the exact supported Emerald ROM hash before activating revision-specific memory reads.
- Pin build containers by digest and add CI checks for ROMs, saves, credentials, generated sprites, and secrets.

Acceptance: a clean clone produces the ROM-free CIA and server image using documented, pinned inputs.

## Gate 1: Anonymous Identity and PostgreSQL

### Identity

- Silently create a server-issued UUID and 256-bit token on first connection.
- Store credentials in private `identity.cfg`; never use Nintendo hardware IDs.
- Continue using the active save’s trainer name, including allowing duplicates.
- Show a short identity fingerprint only on profile/detail/moderation screens so players can distinguish impersonators without appending tags to every name.
- Provide an optional one-time recovery code. Store only its verifier and rotate all credentials after recovery.
- Support immediate device/browser session revocation and complete identity deletion.

### Database

Use the installed CNPG operator with two instances, Longhorn storage, External Secrets, migrations, scheduled backups, and restore testing. Object-level backup encryption is a separate infrastructure gate: the current MinIO service has no KMS, so do not claim encryption at rest until one is configured and a restore is repeated.

Store:

- Identities and hashed credentials.
- Browser sessions and pairing state.
- Preferences and leaderboard consent.
- Blocks, sanctions, and reports.
- Forum and defect records.
- Stat snapshots and session summaries.
- Beta builds and compatibility reports.
- Moderation audit history.

Do not store routine map chat, live DMs, raw link packets, save files, party data, inventory, or ROM-derived content.

Retention defaults:

- Pairing codes: five minutes.
- Browser sessions: 30 idle days.
- Raw security/IP logs: seven days.
- Report evidence: 90 days.
- Deleted forum content: 30-day recovery window.
- Moderation audit records: one year.
- Public stats: removed immediately from display after opt-out and purged within 30 days.

Acceptance: enrollment, reconnect, recovery, revocation, export, deletion, backup, and restoration all pass.

## Gate 2: Small Integrated Community Forum

Build a bounded community service in the existing Node/PostgreSQL stack rather than deploying Discourse or recreating a full social network.

### Access

Mixed visibility:

- Public: installation help, service status, releases, known confirmed defects, and fixed defects.
- Paired-only: beta discussion, development discussion, profiles, leaderboard participation, and all posting.
- Moderator-only: report evidence, sanctions, audit history, and deleted content.

Browser pairing uses a five-minute code approved by the authenticated 3DS. Issue rotated HttpOnly, Secure, SameSite cookies and log only hashed session identifiers.

### Initial forum capability

Ship only:

- Announcements and Releases.
- Beta Testing.
- Bugs and Defects.
- Development and Code.
- Feature Ideas.
- Multiplayer Help.
- General Discussion.
- Sanitized Markdown and code blocks.
- Topic creation, replies, edits, pagination, search, subscriptions, locking, pinning, moving, and reporting.

Defer attachments, reactions, private-message history, email notifications, and reputation systems.

### Structured defects

Each defect has:

- Summary, severity, description, reproduction steps, expected/actual behavior.
- Runtime version and artifact hash.
- Old/New 3DS model, CIA/3DSX installation, and WSS/TCP transport.
- Sanitized diagnostic text.
- Linked discussion topic, target release, related commit/PR, and duplicate relationship.

Lifecycle:

`new → needs-information → confirmed → in-progress → needs-retest → fixed → closed`

Acceptance: a user with broken pairing can read recovery/help information, while posting and private beta content remain protected.

## Gate 3: Leaderboards and Player Profiles

### Consent and privacy

- Require explicit per-device consent before uploading save-derived statistics.
- Explain every uploaded field on the 3DS.
- Permit field-level opt-out and complete historical deletion.
- Never upload trainer ID, Pokémon, party, moves, inventory, save data, or ROM content.

### Initial boards

- Pokédex caught and seen.
- Badge/completion milestones.
- Battle Frontier streak by facility and mode.
- Completed online battles.
- Completed online trades.
- Beta compatibility contributions.

Do not rank chat volume, forum posts, reports, or raw online time.

### Integrity terminology

Use:

- `Server-observed`: the relay saw a qualifying session.
- `Peer-confirmed`: both participants reported the same completion event.
- `Community-submitted`: read from client-owned save memory.
- `Under review`: excluded due to anomalous or impossible changes.

Never call a score “verified” merely because the server received it. Do not rank battle wins until both-client result detection is physically validated. Suspicious values are quarantined, not automatically punished.

Acceptance: consent enforcement, sanity checks, anomaly review, opt-out, deletion, pagination, and per-release boards all pass.

## Gate 4: Link Multiplayer Feasibility Spike

Before integrating battle/trade invitations into the production hub:

1. Enable gpSP `mul_poke` and implement the libretro netpacket callbacks.
2. Complete a LAN Cable Club connection between two emulator instances.
3. Complete a LAN battle and trade between a physical 3DS and a second client.
4. Repeat through public WSS with latency, jitter, packet-loss, and reconnect testing.
5. Verify both saves after trade, restart, and interruption.
6. Confirm 60 FPS and stable audio on Old 3DS.

Always flush and create a timestamped save backup before entering a link session, retaining the newest three.

Go/no-go rule:

- If complete battles and trades survive physical testing, proceed to Gate 5.
- If only presence/handshake works, label link mode experimental and do not expose public trade invitations.
- If Serial-Poke is unreliable, retain the community platform and investigate RFU or a different emulator core separately.

## Gate 5: Context-Aware 3DS Multiplayer Hub

Replace `partyPage` with explicit states:

- Overview.
- Trainer detail.
- Map chat.
- Consent DM.
- Incoming invite.
- Link setup.
- Active link.
- Report/block.
- Diagnostics.

The overview shows nearby radar, trainer cards, chat preview, party health, emotes, and connection status.

Trainer actions:

- Message request.
- Battle.
- Trade.
- Wave.
- Block.
- Report.
- View identity fingerprint.

During invites and link sessions, prioritize readiness, latency, peer state, Cable Club instructions, backup completion, timeout, and cancellation.

Suppress remote top-screen trainers outside a validated overworld context. Keep party, save, and inventory information local.

## Protocol Changes

Protocol v2 adds:

- Identity: `enroll`, `hello`, `recover_identity`, `revoke_session`.
- Pairing: `pair_browser_approve`.
- Stats: `stats_consent`, `stats_snapshot`.
- Community safety: `block`, `unblock`, `report`.
- Messaging: `dm_request`, `dm_respond`, `dm_send`.
- Multiplayer: `invite_create`, `invite_respond`, `invite_cancel`, `link_ready`, `link_packet`, `link_leave`.
- Testing: `compatibility_report`.

Continue supporting v1 presence/chat/emotes during migration. Replace substring-based client JSON parsing with a bounded parser supporting escaped strings, additive fields, strict sizes, and version negotiation.

## Deferred Work

- Screenshot and log attachments. When introduced, require allowlisted formats, signature validation, generated filenames, size limits, CSRF protection, storage outside the webroot, image rewriting, and malware scanning.
- Full Hoenn map and navigation.
- Bag and Pokédex browsers.
- Persistent direct-message history.
- Forum reactions, reputation, and email notifications.
- Horizontally scaled presence/link relays.
- Direct RAM mutation or custom battle engines.

## Final Acceptance

The platform is ready for public beta only when:

- The repository and GPL source gate passes.
- Identity recovery, revocation, deletion, and database restoration work.
- Essential support remains publicly readable.
- Forum authorization and Markdown sanitization pass security tests.
- Leaderboard labels accurately describe data integrity.
- Public WSS works on Old and New 3DS.
- Brendan and May work across two physical clients.
- Top-screen orientation and overworld-only overlays are confirmed.
- Complete physical battle/trade/save tests pass—or link functionality remains clearly disabled and experimental.
