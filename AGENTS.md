# Agent Guide — Emerald Online 3DS

This file is for AI coding agents. It assumes no prior knowledge of the project. Read it before editing code, adding tests, or changing the build/deployment pipeline.

## Project overview

Emerald Online 3DS is a clean-room homebrew framework that adds online presence (same-map trainer overlays, chat, emotes, browser-paired community forums, and opt-in leaderboards) to a legally obtained Pokémon Emerald cartridge dump running on Nintendo 3DS hardware. The repository intentionally contains no ROM, game source, maps, dialogue, graphics, audio, or other copyrighted game data. Users supply their own dump; do not redistribute generated game data.

The runtime is a dedicated 3DS frontend built around a pinned, GPL-2.0-only gpSP ARM dynarec core. It boots only the user’s private Emerald dump, renders the game on the 400×240 top screen, and renders the online dashboard on the 320×240 touch screen. The public transport is an authenticated WebSocket at `wss://live.emeraldonline3ds.com/game`; raw TCP is reserved for trusted LAN development.

The server is deliberately content-agnostic: the client owns local simulation and sends compact presence state; the server validates authentication, sequence, position, map membership, rate limits, and consent, then broadcasts same-map snapshots and a separate global read-only roster. PostgreSQL persists identity and community metadata plus explicitly consented aggregate scores. It never stores Trainer ID, Pokémon, moves, ROM/save/party/inventory data, or routine chat.

Current version is **0.8.8**.

## Technology stack

- **Server / public web**: Node.js 20+, ES modules (`.mjs`), no transpiler. Uses built-in `node:net`, `node:http`, `node:crypto`, `node:fs`, plus `pg`, `ws`, `qrcode`, and `pngjs`.
- **Database**: PostgreSQL 17.6, managed in production by CloudNativePG. Migrations are plain `.sql` files run by `server/tools/migrate.mjs`.
- **Client / runtime**: C/C++ for Nintendo 3DS using devkitARM/libctru/Citro2D/Citro3D/3dsx homebrew toolchain. Uses mbedtls for TLS, gpSP for GBA emulation.
- **Emulator reference**: Azahar 2126.0 for headless/headed smoke tests on Linux.
- **Container / orchestration**: Docker multi-arch (`linux/amd64`, `linux/arm64`), Kubernetes, Traefik ingress, NetworkPolicy default-deny, Prometheus metrics, Grafana dashboard.
- **Testing**: Node.js built-in test runner (`node --test`). No Jest/Mocha.

## Repository structure

```
├── client/                 # Minimal devkitARM 3DSX skeleton (not the production runtime)
├── gpsp-runtime/           # Production 3DS runtime (C/C++, Makefile, builds CIA/3DSX)
│   └── source/
│       ├── main.cpp        # gpSP frontend, online protocol, rendering
│       ├── ui/             # Bottom-screen pages and localization
│       ├── network/        # HTTP/HTTPS client and TLS helpers
│       └── runtime/        # Logging and diagnostics
├── server/
│   ├── src/                # Presence server and data stores
│   │   ├── server.mjs      # TCP/WebSocket presence server
│   │   ├── protocol.mjs    # Message validation and protocol constants
│   │   ├── identity-store.mjs
│   │   ├── community-store.mjs
│   │   ├── stats-store.mjs
│   │   ├── quest-store.mjs, npc-store.mjs, resource-node-store.mjs
│   │   ├── skill-store.mjs, title-store.mjs
│   │   ├── friend-store.mjs, guild-store.mjs
│   │   ├── teleport-store.mjs, metrics.mjs, markdown.mjs
│   │   └── release-catalog.mjs, known-issue-catalog.mjs, community-publication-catalog.mjs
│   ├── test/               # Node test files (run with `node --test`)
│   ├── migrations/         # Ordered `.sql` migration files
│   └── tools/              # CLI utilities (migrate, publish-releases, retention, admin-roles)
├── web/
│   ├── install-server.mjs  # Public website, QR installer, WSS bridge, release API
│   ├── community-app.mjs   # Browser-paired community API backend
│   ├── community-page.mjs  # Community SPA HTML/JS bundle
│   ├── status-page.mjs     # Public status page renderer
│   └── *.test.mjs          # Web tests
├── tools/                  # Operator/development scripts (ROM inspector, smoke tests, admin tools)
├── scripts/                # Build and audit shell/PowerShell scripts
├── deploy/                 # Kubernetes, PostgreSQL, secrets, maintenance, Grafana manifests
├── release/                # Release catalog, known issues, community pages, checksum manifest
├── protocol/PROTOCOL.md    # Application protocol v2 specification
├── third_party/gpsp/       # Vendored, modified gpSP source (GPL-2.0)
├── assets/                 # Project-owned icon, banner, web logo, release media
├── generated/              # Ignored build output and SD-card staging
└── .tools/                 # Ignored local emulator/tooling cache
```

## Build and test commands

All commands run from the repository root.

```sh
# Install dependencies
npm ci

# Run automated tests (memory stores; Postgres tests skip unless TEST_DATABASE_URL is set)
npm test

# Start the presence server locally (requires DATABASE_URL or PG* variables for protocol v2)
node server/src/server.mjs

# Run migrations
npm run db:migrate

# Build public release artifacts (CIA, 3DSX, source archive, checksums). Requires Docker and a validated ROM.
npm run build:public

# Build a private SD-card package including ROM and avatar atlas
npm run build:private

# Validate release catalog hashes and source-package privacy
npm run audit:release

# Validate release catalog without publishing
npm run release:validate

# Sync release catalog artifact list
npm run release:sync

# Publish/upsert official release topics (idempotent)
npm run release:publish

# Start the public installer/community web server
npm run install-page

# Smoke tests (require Azahar AppImage under .tools/ and Xvfb for emulator tests)
npm run smoke:emulator
npm run smoke:emulator:link
npm run smoke:live:gate3
npm run smoke:live:link
```

CI (`.github/workflows/ci.yml`) runs: `npm ci`, `npm test`, `npm run build:public`, `npm run audit:release`, `docker build`.

## Code organization

- **Presence server** (`server/src/server.mjs`) is a stateful TCP/WebSocket server. It creates `createPresenceServer({ host, port, identityStore, statsStore, ... })` and exposes `.server`. It handles protocol v2 authentication, presence snapshots, chat, emotes, stats, teleport, quests, NPCs, friends, guilds, and the experimental Gate 4 link relay.
- **Protocol** (`server/src/protocol.mjs`) exports `VERSION`/`LEGACY_VERSION`, `MAX_LINE` (4096 bytes), and validation functions for every message type. Add new message types here first.
- **Stores** (`server/src/*-store.mjs`) implement data access. Each durable store has a `Postgres*` class and usually a `Memory*` class for unit tests. Keep SQL in the Postgres class; keep business logic in `server.mjs` or in store methods that are reusable.
- **Catalogs** (`release-catalog.mjs`, `known-issue-catalog.mjs`, `community-publication-catalog.mjs`) format JSON catalog entries into community topics and compute content hashes for idempotent publishing.
- **Web bridge** (`web/install-server.mjs`) serves the installer page, static release files, `/api/release`, `/api/status`, `/health`, and bridges public WSS connections to the local presence TCP server.
- **Community app** (`web/community-app.mjs`) handles browser pairing, sessions, CSRF, rate limits, forum topics/posts, profiles, and leaderboards.

## Code style guidelines

- Use ES modules (`.mjs`). `package.json` sets `"type": "module"`.
- Prefer built-in Node modules. Avoid adding dependencies without a strong reason; check `package.json` first.
- Use `assert/strict` in tests.
- Server-side code uses `camelCase` for variables and `snake_case` only when mapping to/from PostgreSQL columns.
- Protocol messages use `snake_case` field names and lowercase `type` strings.
- C/C++ runtime code uses 2-space indentation; follow the existing file style.
- Keep privacy boundaries explicit: never log tokens, recovery codes, pairing codes, ROM data, saves, party/inventory, or player IPs in clear text.

## Testing instructions

- Test runner: `node --test server/test/*.test.mjs web/*.test.mjs`.
- Memory-backed tests run by default. PostgreSQL-backed tests are skipped unless `TEST_DATABASE_URL` is set.
- To run with Postgres locally:
  ```sh
  export TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/emerald_test"
  npm test
  ```
- `runtime-source.test.mjs` reads the C/C++ source and asserts architectural invariants (ROM path, TLS settings, protocol strings, no hardcoded private IPs). Update it when you change the runtime.
- `link-test-package.test.mjs` validates that no ROM, save, identity, or avatar file leaks into generated physical-test bundles.
- `documentation-current.test.mjs` checks that `README.md` mentions the current `package.json` version.
- Smoke tests under `tools/emulator-*.mjs` and `tools/live-*.mjs` are manual/automation helpers, not part of `npm test`.
- Always run `npm test`, `npm run build:public`, and `npm run audit:release` before pushing.

## Security considerations

- **Identity**: Protocol v2 issues a UUID identity, a credential UUID, and a 256-bit token. The raw token and recovery code are returned once over TLS. PostgreSQL stores only HMAC-SHA256 token hashes (peppered) and scrypt recovery-code verifiers. `IDENTITY_PEPPER` must be at least 32 bytes.
- **Browser pairing**: A five-minute code is approved from the authenticated 3DS. The request token stays in the browser tab. On consumption, the server rotates to a 256-bit session token stored as a hashed verifier. Cookies are `HttpOnly`, `Secure`, `SameSite=Strict`; state-changing requests require a session-derived CSRF token.
- **Transport**: Public traffic uses TLS-authenticated WebSockets. Raw TCP is cluster-internal/LAN-only. The 3DS client validates hostname, chain, expiry, and signature; it accepts only `MBEDTLS_X509_BADCERT_FUTURE` within a 14-hour civil-timezone skew window.
- **Secrets**: Database password, identity pepper, and backup credentials come from Kubernetes secrets (`emerald-runtime`, `emerald-pg-app`, `emerald-backup`) produced by External Secrets. Never commit secrets; `.gitignore` excludes `.env*`, `identity.cfg`, `online.cfg`, `stats.cfg`, and generated/private files.
- **Container hardening**: The Docker image runs as non-root `node`, drops all capabilities, has a read-only root filesystem, no service-account token, and seccomp `RuntimeDefault`. The image must contain only the Node app and ROM-free release artifacts; `scripts/audit-release.sh` verifies the source archive excludes ROMs, saves, credentials, private IPs, and infrastructure identifiers.
- **NetworkPolicy**: Default-deny ingress/egress. Explicit policies allow Traefik→web, Prometheus→metrics, node health probes, same-namespace traffic, DNS, MinIO backups, and CNPG operator/API traffic only.
- **Privacy**: Do not store or transmit ROM data, saves, party, inventory, Trainer ID, Pokémon, moves, or routine chat. Aggregate stats are opt-in per field; leaderboards label save-derived entries as `Community-submitted` and compatibility entries as `Server-observed`.

## Deployment

Production runs on Kubernetes in the `pokemonemeraldonline3ds` namespace.

Apply order:

```sh
kubectl apply -f deploy/external-secrets.yaml
kubectl -n pokemonemeraldonline3ds wait --for=condition=Ready externalsecret/emerald-runtime --timeout=90s
kubectl apply -f deploy/postgres.yaml
kubectl -n pokemonemeraldonline3ds wait --for=condition=Ready clusters.postgresql.cnpg.io/emerald-pg --timeout=10m
kubectl apply -f deploy/kubernetes.yaml
kubectl apply -f deploy/maintenance.yaml
kubectl -n pokemonemeraldonline3ds rollout status deployment/emerald-online
```

The Deployment has two init containers:
1. `migrate` — runs `server/tools/migrate.mjs` with advisory locking.
2. `publish-releases` — upserts official release, known-issue, and community-page topics.

The pod has two application containers:
- `presence` — `node server/src/server.mjs` on ports 3210 (game) and 3211 (health/metrics).
- `public-web` — `node web/install-server.mjs` on port 8080.

Presence is single-replica because room state is in memory. After a release build, push multi-arch images, update image digests in `deploy/kubernetes.yaml` and `deploy/maintenance.yaml`, and verify the public CIA checksum matches `release/SHA256SUMS`.

## Release process

1. Update `package.json` version to match the newest entry in `release/release-catalog.json`.
2. Run `npm run release:validate` to confirm catalog, checksums, and known issues are consistent.
3. Run `npm run build:public` to build the ROM-free CIA, 3DSX, source archive, and checksum manifest.
4. Run `npm run audit:release` to verify no private data leaks into the source archive.
5. Commit the updated `release/` files and manifests.
6. Build and push the multi-arch Docker image; update image digests in deployment manifests.
7. Deploy. Init containers publish official topics idempotently; only the newest release is pinned.

The public source archive contains only the runtime, modified gpSP source, Makefiles, `LICENSE.txt`, and `VERSION.txt`. It excludes Markdown, server/web/deploy directories, assets, tools, generated output, ROMs, saves, credentials, and private addresses.

## Development conventions

- **Migrations**: Add new `.sql` files to `server/migrations/` with a zero-padded sequential prefix (e.g., `014_...sql`). The migrator applies them in order inside an advisory lock and records them in `schema_migrations`.
- **New protocol messages**: Add validation to `server/src/protocol.mjs`, add constants/regexes as needed, and add handling to `server/src/server.mjs`. Mirror changes in the 3DS runtime and update `protocol/PROTOCOL.md`.
- **New stores**: Provide both `Postgres*` and `Memory*` classes when the feature is exercised by unit tests. Keep SQL contained; expose the same method signatures.
- **Environment variables**: The presence server reads `GAME_HOST`, `GAME_PORT`, `HEALTH_PORT`, `IDLE_MS`, `MAX_CONNECTIONS`, `MAX_CONNECTIONS_PER_IP`, `HELLO_TIMEOUT_MS`, `DATABASE_URL` or `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`, and `IDENTITY_PEPPER`. The web server reads `INSTALL_HOST`, `INSTALL_PORT`, `PUBLIC_BASE_URL`, `GAME_PUBLIC_URL`, `GAME_UPSTREAM_HOST`/`PORT`, `STATUS_UPSTREAM_HOST`/`PORT`, and database variables.
- **Logging**: Avoid logging raw tokens, IPs, or player data. Metrics (`server/src/metrics.mjs`) expose only aggregate counts and readiness; verify with `metrics.test.mjs` that no player identifiers leak.
- **3DS runtime changes**: The production runtime is in `gpsp-runtime/`, not `client/`. The `client/` directory is a minimal skeleton. Build the production runtime with `npm run build:public` or `scripts/build-runtime.sh`.
- **RFU/link experiment**: The Gate 4 opt-in link room is disabled by default. It requires `link_room=XXXX-XXXX` in `online.cfg`, exactly two authenticated v2 clients, and uses gpSP’s Emerald RFU backend. Public battle/trade invitations and rankings remain disabled until physical acceptance passes.

## Public repository hygiene

This project keeps a **private Gitea mirror** for day-to-day development and a **public GitHub mirror** for release distribution. The public GitHub repository must never contain anything that could reveal identity, physical location, server infrastructure, or credentials.

**Sanitize before every push to the public GitHub repo.** The private Gitea repo may keep the real values.

Before force-pushing `main` to `github`, verify and replace:

- Private IP addresses and CIDRs (home network, Kubernetes nodes, pods, 3DS FTP endpoint)
- Internal registry hostnames/ports (use `<your-registry>`)
- Kubernetes node hostnames (use `<node-1>` and `<node-2>`)
- Internal namespace names (use `<backup-namespace>`)
- Git commit author name/email (use a project identity such as `Emerald Online 3DS <noreply@emeraldonline3ds.com>`)
- Real 3DS FTP IPs in docs/agent notes

Acceptable placeholders include `<your-registry>`, `<node-1>`, `<node-2>`, `<node-cidr>`, `<pod-cidr>`, `<backup-namespace>`, and `<3ds-ip>`.

Do **not** rewrite history on the private Gitea remote; that mirror is allowed to retain operational details.

## Useful references

- `README.md` — high-level project description and user-facing setup.
- `TESTING.md` — detailed hardware, emulator, and release smoke-test checklists.
- `RELEASE_PUBLISHING.md` — catalog format, media, source-package, and publication contract.
- `COMMUNITY_PLATFORM_PLAN.md` — phased roadmap and gate acceptance criteria.
- `protocol/PROTOCOL.md` — application protocol v2 specification.
- `deploy/README.md` — Kubernetes deployment, secrets, backup, and recovery instructions.
- `BOTTOM_SCREEN_HANDOFF.md`, `3DS_RUNTIME_UPGRADES.md`, `OBSERVABILITY_HANDOFF.md`, `GATE_*_HANDOFF.md` — milestone-specific engineering notes.
