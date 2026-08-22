# Observability and bounded load-test handoff

This phase adds privacy-safe operational telemetry without changing the game protocol or collecting additional player data.

## Metrics

The presence status server exposes Prometheus text at cluster-internal `/metrics` on port 3211. Metrics contain only aggregate gauges and counters: connection capacity/current use, authenticated and positioned counts, occupied map/link rooms, protocol activity, rejections/timeouts, authentication failures, experimental link activity, uptime, database readiness, and process memory.

Player names, fingerprints, identity IDs, credentials, IP addresses, map identifiers, chat content, ROM/save data, party data, and inventory are never labels or samples. The endpoint is not routed through the public website. Prometheus discovers the pod through annotations, and NetworkPolicy permits port 3211 only from the existing Prometheus pod plus the already-required node health probes.

## Dashboard

`deploy/grafana-dashboard.json` defines the `Emerald Online 3DS` dashboard with 12 panels for players, capacity, database readiness, rooms, session activity, protocol throughput, failures, experimental link traffic, memory, and uptime. The dashboard is imported into the existing authenticated Grafana instance through its API; no Grafana credential is stored in this repository.

## Load harness

`npm run load:test` drives protocol-v1 ephemeral sessions so tests do not create persistent identities. Defaults are deliberately bounded to 24 clients, 10 seconds, and five state updates per client per second. Hard limits are 48 clients, 60 seconds, and 10 Hz. Non-loopback targets are rejected unless `ALLOW_REMOTE_LOAD_TEST=YES` is explicitly set.

Local phase evidence used 32 concurrent clients for five seconds at 5 Hz. All clients completed, 768 state updates generated 24,080 snapshots, all 32 pings returned, there were zero protocol errors/rejections/authentication failures, and hello latency was 4.6-7.3 ms with 7.3 ms p95. Presence RSS after the run was about 74 MiB, below the 128 MiB production limit.

## Commands

```sh
npm test
npm run load:test
curl -fsS http://127.0.0.1:3211/metrics
```

For an intentional internal-service run, use a local port-forward and explicit opt-in. Do not point the harness at the public Cloudflare route or exceed the tested bounds during normal service operation.
