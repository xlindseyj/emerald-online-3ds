# Phase 0 handoff: reproducible and ROM-safe baseline

Status: automated gate passed on 2026-08-15; physical retest remains with the tester.

## Build outputs

- `release/emerald-online-3ds.cia`
- `release/emerald-online-3ds.3dsx`
- `release/emerald-online-3ds-source-0.3.2.tar.gz`
- `release/SHA256SUMS`
- Private SD-card tree: `generated/sd-card/` (ignored; never redistribute)

Use `npm run build:private` to rebuild the tester's SD-card tree from the exact supported US Emerald ROM. Use `npm run build:public` for the redistributable ROM-free artifacts.

## Acceptance evidence

- Node protocol/runtime/web suite: 16/16 passing.
- Public CIA and 3DSX build from pinned devkitARM and packaging container digests.
- Corresponding source is deterministically archived, includes GPL license and modified gpSP source, and excludes ROMs, saves, identity/config files, generated atlases, Git metadata, and compiler output.
- Release checksums validate with `npm run audit:release`.
- Production image builds, runs read-only with all Linux capabilities dropped, serves healthy presence/web endpoints, and serves the exact source archive.
- npm production dependency audit: zero known vulnerabilities.
- Gitleaks scan covers project and vendored gpSP source; ignored local reference checkouts are explicitly excluded because they are neither tracked nor distributed.
- Official Azahar 2126.0 headless smoke: boot, stable reconnect identity, stationary keepalive, automatic reconnect/state republish, movement, chat, and four emotes all passed.

## Tester checklist

Copy `generated/sd-card/` to the SD root and follow `TESTING.md`. Confirm the public WSS path, May avatar on physical hardware, a two-client exchange, and final top-screen left-to-right orientation. Report the CIA checksum with any defect so the result maps to an exact build.

Phase 1 may proceed without those confirmations, but no public release should be called hardware-accepted until they pass.
