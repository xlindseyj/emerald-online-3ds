# Presence protocol v2

The application protocol is UTF-8 newline-delimited JSON. A line may not exceed 4096 bytes. The public 3DS transport is an authenticated WebSocket at `wss://live.emeraldonline3ds.com/game`; raw TCP is cluster-internal and is available only for trusted LAN development.

## Identity bootstrap and authentication

New v2 clients enroll before sending presence. The server issues an opaque UUID, credential UUID, 256-bit device token, and display-only fingerprint. A client may request a one-time recovery code. The raw device token and recovery code are returned over TLS once; the database stores only keyed or memory-hard verifiers.

```json
{"type":"enroll","version":2,"name":"May","avatar":"girl","recovery":true}
{"type":"enrolled","version":2,"id":"00000000-0000-4000-8000-000000000000","credentialId":"00000000-0000-4000-8000-000000000001","token":"64-lowercase-hex-digits","fingerprint":"A1B2C3D4E5","recoveryCode":"ABCD-EFGH-JKLM-NPQR-STUV"}
```

The 3DS saves `id`, `credential`, `token`, and `fingerprint` atomically in `identity.cfg`, separate from public endpoint preferences in `online.cfg`. It displays the recovery code only for the enrollment session; users should record it offline.

Returning clients authenticate with the server-issued identity and token:

```json
{"type":"hello","version":2,"name":"May","identity":"00000000-0000-4000-8000-000000000000","token":"64-lowercase-hex-digits","avatar":"girl"}
{"type":"welcome","version":2,"id":"00000000-0000-4000-8000-000000000000","fingerprint":"A1B2C3D4E5"}
```

Recovery invalidates every existing device credential and browser session, consumes the recovery code, and issues one replacement credential:

```json
{"type":"recover_identity","version":2,"name":"May","identity":"00000000-0000-4000-8000-000000000000","recoveryCode":"ABCD-EFGH-JKLM-NPQR-STUV","avatar":"girl"}
{"type":"identity_recovered","version":2,"id":"00000000-0000-4000-8000-000000000000","credentialId":"00000000-0000-4000-8000-000000000002","token":"64-lowercase-hex-digits","fingerprint":"A1B2C3D4E5"}
```

Authenticated clients may send `export_identity`, `revoke_session`, or `delete_identity` with `confirm:"DELETE"`. Export contains account metadata and preferences, never credential verifiers. Revocation and deletion close the connection.

## Presence messages

After authentication, clients may send:

```json
{"type":"state","seq":1,"map":"littleroot","x":12,"y":8,"facing":"down","avatar":"girl"}
{"type":"chat","text":"Hello!"}
{"type":"emote","emote":"wave"}
{"type":"ping","at":1234}
```

Server messages include `snapshot`, `chat`, `emote`, `pong`, and `error`. Coordinates are integer tile coordinates from 0 through 4095. Names are 1-12 printable ASCII characters. Chat is 1-80 printable ASCII characters; quotes and backslashes are excluded. Chat is same-map only and limited to one message per second. Emotes are `wave`, `battle`, `trade`, or `gg`, same-map only, and limited to one every two seconds. Facing is `up`, `down`, `left`, or `right`. Sequence numbers must increase.

Clients should send a `ping` at least every 20 seconds while stationary. The 3DS runtime uses a 10-second interval and automatically reconnects. A reconnect authenticates again and republishes current state. Selecting offline mode suppresses reconnect attempts.

`avatar` is `boy` or `girl`. The runtime derives it from Emerald's SaveBlock2 player gender. Clients render remote trainers from their own private sprite atlas; sprite pixels and ROM/save contents are never sent.

Snapshots are presence hints, not authoritative save data. Clients must not trust them for battles, trades, inventory, progression, or leaderboard proof.

## v1 migration window

Protocol v1 `hello` remains accepted temporarily so already-installed builds continue to connect while users update. Its optional 32-hex `session` produces a stable opaque ID but is not Internet-grade authentication. The server replies with `latestVersion:2`. New builds must use v2, and v1 removal requires a separately announced compatibility gate.
