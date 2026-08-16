# Automated release forum publishing

Every deployed Emerald Online 3DS release is published to the public Releases board at `https://emeraldonline3ds.com/community`. Confirmed project-wide defects are published to Bugs and Defects from `release/known-issues.json`. Production does not scrape commit messages or accept an unauthenticated publishing webhook.

## Release workflow

1. Add the new semantic version to `release/release-catalog.json` with a factual summary, highlights, verification, limitations, upgrade notes, artifact entries, and media captions.
2. Build with `npm run build:public`. After generating `release/SHA256SUMS`, the build synchronizes the current catalog hashes and validates the complete catalog.
3. Run `npm test` and `npm run audit:release`. The audit fails if the latest catalog version differs from `package.json`, any current artifact hash differs from `release/SHA256SUMS`, a post exceeds the forum limit, or media/link data violates the allowlist.
4. Build and push the multi-architecture production image, update every immutable digest in `deploy/`, and apply `deploy/kubernetes.yaml`.
5. Kubernetes runs migrations first, then the `publish-releases` init container. The publisher uses the same TLS-verified, least-privilege application database connection and exits before the web/game containers start.
6. Verify the Releases category anonymously through the public API and page. The newest version must be the only pinned official release.

The homepage reads the version from `package.json` and displays it as `vX.Y.Z`. Catalog validation requires that value to match the newest release entry, so the website, artifacts, and official release post advance together.

`npm run release:publish` is also available for an authorized operator with the normal database environment. It is safe to rerun: `release_publications.release_version` is unique, existing official topics are updated in place, soft-deleted official topics are restored, and the publisher pins only the newest catalog entry. It creates no player identity or long-lived browser credential.

## Formatting and media

Release posts support sanitized headings, lists, code, links, horizontal rules, and same-origin images. Each official post is labeled `OFFICIAL RELEASE`, includes its version/date/source commit, and remains open for paired-player replies.

Known issues use the same idempotent publisher, keyed by a stable issue key. They are labeled `OFFICIAL KNOWN ISSUE`, stored as confirmed structured defects, remain publicly readable, and request only sanitized device and reproduction evidence. The initial issue documents device/scene-dependent FPS fluctuation and the temporary Online off/on workaround after a cutscene.

Allowed image sources are the project logo, the generated FBI setup QR, and files under `assets/release-media/`. Release media must be project-owned and authentic. Prefer emulator or physical-console captures of the original lower-screen UI and setup flow, label their source in the caption, and crop out ROM-derived pixels, private save data, identity credentials, recovery codes, and personal information. Remote images and tracking pixels are rejected.

The downloadable source archive is a separate code-only allowlist. It includes the 3DS runtime frontend, modified gpSP source, Makefiles, a plain-text version marker, and GPL text. It excludes every `.md` file plus server, website, Kubernetes, operator scripts, release media, screenshots, icons, and other branded assets. `npm run audit:release` extracts the archive and rejects Markdown, secret-like filenames, private IP ranges, internal service names, infrastructure references, repository metadata, binaries, and media files before publication.

The initial backfill contains factual posts for 0.3.2, 0.5.0, 0.6.1, 0.7.1, and 0.8.0. Historical builds are clearly marked superseded and are not offered as current downloads.

The first production publication completed on 2026-08-16. Migration 004 and the publisher init container exited successfully, anonymous reads returned all five official topics, 0.8.0 was the sole pinned version, and a deliberate second run preserved the same 0.8.0 topic ID. The follow-up rollout applied migration 005 and published the confirmed FPS issue under stable topic ID `b3570148-29d7-44e8-b60c-944f9874bf17`; anonymous reads showed official attribution, confirmed status, no player identity, and the documented workaround.

## Failure behavior

If catalog validation or publication fails, the init container fails and the new application pod does not start. The previous production pod remains the rollback target. Do not bypass the publisher merely to obtain a Ready pod; correct the catalog, migration, database access, or content error and redeploy.
