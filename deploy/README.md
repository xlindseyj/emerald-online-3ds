# Kubernetes deployment

`kubernetes.yaml` deploys the presence server and public installer/WebSocket
bridge to namespace `pokemonemeraldonline3ds`. The Emerald ROM, save, session
token, and private avatar atlas remain on each player's SD card and are excluded
from the container context.

Public routes:

- Website and CIA: `https://pokemon.lws-workspace.com`
- 3DS game transport: `wss://pokemon-server.lws-workspace.com/game`
- Cluster-only raw protocol: `emerald-online.pokemonemeraldonline3ds.svc.cluster.local:3210`
- Cluster-only status: `emerald-online.pokemonemeraldonline3ds.svc.cluster.local:3211/health`

The LWS Workspace Cloudflare tunnel routes both public hostnames to Traefik.
Cloudflare DNS contains proxied CNAMEs to tunnel
`fe20f593-df49-4e2d-92fd-a7df2be8a697`. Arbitrary Cloudflare Tunnel TCP routes
require a `cloudflared` client and therefore cannot be used by an unmodified 3DS;
the runtime uses certificate-validated WSS on port 443 instead.

The deployment is restricted, non-root, has no service-account token, uses
default-deny network policies, and is pinned to a multi-architecture registry
digest. Presence state is in memory, so the deployment intentionally remains at
one replica until a shared room backend exists.

Apply and verify:

```sh
kubectl apply -f deploy/kubernetes.yaml
kubectl -n pokemonemeraldonline3ds rollout status deployment/emerald-online
curl -fsS https://pokemon.lws-workspace.com/health
```

After rebuilding the CIA, rebuild and push an `amd64,arm64` image, replace both
image digests in `kubernetes.yaml`, and verify that the public CIA SHA-256 equals
`release/emerald-online-3ds.cia`.
