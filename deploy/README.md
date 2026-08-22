# Kubernetes deployment and recovery

The production namespace is `pokemonemeraldonline3ds`. It contains one combined presence/WebSocket pod, a two-instance CloudNativePG PostgreSQL cluster, External Secrets, daily retention cleanup, and encrypted MinIO backups. ROMs, saves, `identity.cfg`, `online.cfg`, and the private avatar atlas never enter Kubernetes or the image context.

## Public routes

- Website, community, health, and CIA: `https://emeraldonline3ds.com`
- Website alias: `https://www.emeraldonline3ds.com`
- Primary 3DS transport: `wss://live.emeraldonline3ds.com/game`
- Temporary game alias: `wss://game.emeraldonline3ds.com/game`
- Cluster-only protocol: `emerald-online.pokemonemeraldonline3ds.svc.cluster.local:3210`
- Cluster-only status: `emerald-online.pokemonemeraldonline3ds.svc.cluster.local:3211/health`
- Cluster-only Prometheus metrics: `emerald-online.pokemonemeraldonline3ds.svc.cluster.local:3211/metrics`

Cloudflare proxied CNAMEs target tunnel `fe20f593-df49-4e2d-92fd-a7df2be8a697`. Arbitrary Tunnel TCP routes require a `cloudflared` client and cannot serve an unmodified 3DS, so the runtime uses certificate-validated WSS on port 443.

## Secrets and database

`deploy/external-secrets.yaml` reads only `secret/data/lws/runtime/emerald-online-3ds` through `ClusterSecretStore/vault-backend`. Required properties are:

- `database_password`
- `identity_pepper` (at least 32 bytes)
- `backup_access_key`
- `backup_secret_key`

External Secrets produces `emerald-pg-app`, `emerald-runtime`, and `emerald-backup`. The runtime uses separate `PGHOST`/`PGUSER`/`PGPASSWORD` fields rather than embedding arbitrary passwords in a URL. Never commit or print the values.

`deploy/postgres.yaml` provisions PostgreSQL 17.6 on the two Longhorn-capable nodes, uses TLS for application connections, prefers separate nodes, and writes compressed base backups and WAL to `s3://cnpg-backups/emerald-online-3ds`. `emerald-pg-daily` runs at 04:17 UTC and starts an immediate backup when first created. Retention is 30 days. The current MinIO service has no KMS configured, so CNPG object-level SSE must remain disabled; enable a MinIO KMS before claiming backup encryption at rest.

The namespace has default-deny ingress and egress. CNPG instance-manager pods need Kubernetes API host traffic; Cilium/Flannel host DNAT cannot express that destination with a portable Kubernetes `ipBlock`, so `allow-cnpg-kubernetes-api` grants unrestricted egress only to pods labeled `cnpg.io/cluster=emerald-pg`. Application and maintenance pods retain explicit same-namespace, DNS, and MinIO rules. Revisit this with a Cilium `toEntities: host` policy if the namespace is migrated fully to Cilium-native policy.

## Apply order

```sh
kubectl apply -f deploy/external-secrets.yaml
kubectl -n pokemonemeraldonline3ds wait --for=condition=Ready externalsecret/emerald-runtime --timeout=90s
kubectl apply -f deploy/postgres.yaml
kubectl -n pokemonemeraldonline3ds wait --for=condition=Ready clusters.postgresql.cnpg.io/emerald-pg --timeout=10m
kubectl apply -f deploy/kubernetes.yaml
kubectl apply -f deploy/maintenance.yaml
kubectl -n pokemonemeraldonline3ds rollout status deployment/emerald-online
curl -fsS https://live.emeraldonline3ds.com/health
```

The Deployment runs idempotent, advisory-locked migrations over verified database TLS, then a second init container validates the release, known-issue, and maintained community-page catalogs. It upserts official Releases, confirmed known issues, installation/emulator help, service status, and the remaining board guides before either application container starts. Publication is keyed by semantic version or stable page/issue key, so restarts and deployment retries update the same topics instead of creating duplicates; only the newest release is pinned. The homepage reads the same package version. The application is non-root, read-only, capability-free, has no service-account token, and uses an immutable multi-architecture image digest. Presence remains one replica because room state is in memory.

After a release build, push both `linux/amd64` and `linux/arm64`, update every image reference in `deploy/kubernetes.yaml` and `deploy/maintenance.yaml`, and verify the public CIA checksum matches `release/SHA256SUMS`.

The presence pod carries Prometheus discovery annotations for `/metrics` on the internal status port. `allow-prometheus-metrics` permits that port only from the `app=prometheus` pod in `<backup-namespace>`; the public ingress continues to expose only the web bridge. Import `deploy/grafana-dashboard.json` through the authenticated Grafana API and verify dashboard UID `emerald-online-3ds`. See `OBSERVABILITY_HANDOFF.md` for metric privacy and load-test limits.

## Backup verification and restore drill

Do not treat a `running` Backup as success. Verify the CNPG conditions and completed timestamp:

```sh
kubectl -n pokemonemeraldonline3ds get backups.postgresql.cnpg.io -o wide
kubectl -n pokemonemeraldonline3ds get clusters.postgresql.cnpg.io emerald-pg -o jsonpath='{.status.conditions}'
```

For a non-destructive restore drill, create an isolated cluster with a different name and bootstrap recovery from the production backup object prefix. Use the same `emerald-backup` object-store credential and a new Longhorn PVC; never point recovery at the live `emerald-pg` cluster. Confirm the restored migration row count and a synthetic marker/identity created before the backup, then delete only the isolated validation cluster and its PVCs. Record backup name, recovery target, row-count evidence, and cleanup in `GATE_1_HANDOFF.md`.

If restoration fails, keep production untouched, inspect the Backup status and instance-manager logs, and verify MinIO IAM before rotating Kubernetes/Vault credentials. A Ready database or HTTP 200 alone is not proof that backup recovery works.
