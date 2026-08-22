# Gate 1 handoff: anonymous identity and PostgreSQL

Gate 1 implementation and automated/live acceptance completed on 2026-08-15. This document preserves the original 0.5.0 handoff evidence; Gate 1's later physical WSS/SD identity acceptance is complete, and current installation/testing must use the release and hashes in `GATE_4_PHYSICAL_TEST.md` rather than the superseded artifacts below.

## Shipped

- Protocol v2 server-issued anonymous UUID, 256-bit device credential, short fingerprint, one-time recovery code, credential recovery/rotation, revocation, export, and deletion.
- Atomic private SD credential storage in `identity.cfg`; Nintendo hardware identifiers are never read.
- Bounded escaped-string JSON parsing on the 3DS while retaining v1 presence compatibility.
- PostgreSQL 17.6 through CNPG with two instances on separate Longhorn-capable nodes, TLS application connections, migrations, External Secrets, retention cleanup, daily backups, and a 30-day backup retention policy.
- `wss://live.emeraldonline3ds.com/game` as the compiled and generated-config default. `game.emeraldonline3ds.com` remains a compatibility alias only.

## Acceptance evidence

- The Node suite passes 19 tests; its PostgreSQL integration test is opt-in locally and the same complete identity lifecycle passed against the live PostgreSQL service through public WSS.
- Enrollment, stable reconnect, export, revocation, recovery, and deletion passed; the synthetic live identity was deleted afterward.
- Official Azahar 2126.0 completed the gpSP interpreter smoke with a persisted server-issued identity, stable reconnect identity, stationary keepalive, automatic reconnect, and state republish.
- CNPG reports two ready instances, healthy continuous WAL archiving, and a successful base backup named `backup-20260815233105`.
- That backup was restored into an isolated cluster. The restore contained the known `gate1_restore_marker_20260815t2331z` event and all eight Gate 1 identity tables. The temporary restore cluster, policies, and PVC were deleted; the source backup remains recoverable.

## Backup encryption caveat

The cluster's MinIO service rejects S3 SSE because no KMS is configured. Backups are compressed and access is restricted to a dedicated bucket/prefix-scoped MinIO user, but encryption at rest is not claimed. Configure a MinIO KMS, re-enable CNPG object encryption, and repeat the restore drill before describing backups as encrypted.

## Historical physical acceptance handoff

The initial transfer exposed an `E71` WebSocket protocol error on physical hardware. A first HTTP header-capitalization fix did not resolve it. The new diagnostics reproduced the error against production in Azahar as mbedTLS `-0x2700` with `MBEDTLS_X509_BADCERT_FUTURE`: the 3DS local wall clock was interpreted as UTC and lagged real UTC by four hours. The current build applies a narrowly bounded timezone-skew exception while retaining every other certificate check, and the exact gpSP build has completed production WSS enrollment in Azahar. The last package copied to the device remains the header-only build. Gate 2 now supersedes the standalone Gate 1 package; transfer the following current 0.5.0 artifacts when ftpd is available:

- `/3ds/emerald-online-3ds/online.cfg` contains `live.emeraldonline3ds.com`, port `443`, `wss`, and `/game`.
- `/3ds/emerald-online-3ds/emerald-online-3ds.3dsx` SHA-256 is `cf41213268f190603f6616c1fcb79f56790537f00a2dd4e48c334361083d68d6`.
- `/cias/emerald-online-3ds.cia` SHA-256 is `d4b32e28b8bf79360897208a660b7f8b9e68d1255c062603890219125d7c0ced`; install it with FBI to update the HOME Menu title.
- The existing ROM, save, save state, debug log, and avatar atlas were not changed. No prior `identity.cfg` existed.
- The prior 3DSX and config are retained locally in ignored `generated/device-backups/physical-3ds-pre-gate1-20260815T2342Z/` for rollback.
- The pre-hotfix 3DSX and config are retained in ignored `generated/device-backups/physical-3ds-pre-wss-header-fix-20260816T000007Z/`.

On the Old 3DS XL, launch the transferred 0.5.0 build and verify:

1. Emerald remains playable at 60 FPS with correct audio and display orientation.
2. The status reaches `ONLINE` through `live.emeraldonline3ds.com:443` without a LAN server.
3. First enrollment creates `identity.cfg` and displays a recovery code and fingerprint.
4. Disconnect/reconnect retains the same fingerprint.
5. A stationary 45-second run stays online; Wi-Fi loss and restoration reconnect automatically.

Record the result in `TESTING.md`. Do not share `identity.cfg`, the recovery code, ROM, save, or private avatar atlas.
