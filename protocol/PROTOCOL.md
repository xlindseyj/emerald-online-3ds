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
{"type":"welcome","version":2,"id":"00000000-0000-4000-8000-000000000000","fingerprint":"A1B2C3D4E5","role":"player"}
```

The `role` field is one of `player`, `moderator`, or `admin` and reflects the authenticated identity's staff roles.

Recovery invalidates every existing device credential and browser session, consumes the recovery code, and issues one replacement credential:

```json
{"type":"recover_identity","version":2,"name":"May","identity":"00000000-0000-4000-8000-000000000000","recoveryCode":"ABCD-EFGH-JKLM-NPQR-STUV","avatar":"girl"}
{"type":"identity_recovered","version":2,"id":"00000000-0000-4000-8000-000000000000","credentialId":"00000000-0000-4000-8000-000000000002","token":"64-lowercase-hex-digits","fingerprint":"A1B2C3D4E5"}
```

Authenticated clients may send `export_identity`, `revoke_session`, or `delete_identity` with `confirm:"DELETE"`. Export contains account metadata and preferences, never credential verifiers. Revocation and deletion close the connection.

## Browser pairing

The community website creates a five-minute code plus a separate 256-bit request token. Only the code is shown to the user; the request token remains in that browser tab. On the online dashboard, the player taps the trainer profile and enters the code. The authenticated 3DS sends:

```json
{"type":"pair_browser_approve","code":"ABCD-EFGH"}
{"type":"browser_pairing_approved","code":"ABCD-EFGH"}
```

The browser can consume the approved code only with its matching request token. The server then rotates the one-time pairing state into a random browser-session token stored only as a hashed verifier. The cookie is `HttpOnly`, `Secure`, and `SameSite=Strict`; state-changing forum requests also require a session-derived CSRF token. Pairing codes expire after five minutes and cannot be reused.

## Presence messages

After authentication, clients may send:

```json
{"type":"state","seq":1,"map":"littleroot","x":12,"y":8,"facing":"down","avatar":"girl"}
{"type":"chat","text":"Hello!"}
{"type":"emote","emote":"wave"}
{"type":"ping","at":1234}
```

Server messages include `snapshot`, `online_users`, `chat`, `emote`, `pong`, `teleport_locations`, `teleport_result`, and `error`. Coordinates are integer tile coordinates from 0 through 4095. Names are 1-12 printable ASCII characters. Chat is 1-80 printable ASCII characters; quotes and backslashes are excluded. Chat is same-map only and limited to one message per second. Each delivered chat includes a server-generated ISO 8601 `sentAt` timestamp. Emotes are `wave`, `battle`, `trade`, or `gg`, same-map only, and limited to one every two seconds. Facing is `up`, `down`, `left`, or `right`. Sequence numbers must increase.

`snapshot` remains strictly same-map and excludes the receiving trainer. `online_users` is a separate global, read-only presence feed containing every authenticated connection, including the receiver. It deliberately exposes only the opaque connection ID, display name, current map, and tile coordinates; it never includes ROM, save, party, inventory, account token, or browser data. A connected trainer that has not sent a valid state yet has an empty map and coordinates of `-1`.

The global feed is sorted by display name and opaque ID, divided into at most 16 users per line, and coalesced to at most one refresh per second:

```json
{"type":"online_users","page":0,"pages":1,"total":2,"users":[{"id":"00000000-0000-4000-8000-000000000000","name":"May","map":"0-9","x":14,"y":13,"role":"player"},{"id":"00000000-0000-4000-8000-000000000002","name":"Wally","map":"0-17","x":6,"y":9,"role":"player"}]}
```

Each user entry includes a `role` of `player`, `moderator`, or `admin`.

The 3DS keeps a bounded chat list only in memory for the current runtime session and filters it to the current map. Routine chat is not written to the server database.

Clients should send a `ping` at least every 20 seconds while stationary. The 3DS runtime uses a 10-second interval and automatically reconnects. A reconnect authenticates again and republishes current state. Selecting offline mode suppresses reconnect attempts.

`avatar` is `boy` or `girl`. The runtime derives it from Emerald's SaveBlock2 player gender. Clients render remote trainers from their own private sprite atlas; sprite pixels and ROM/save contents are never sent.

Snapshots are presence hints, not authoritative save data. Clients must not trust them for battles, trades, inventory, progression, or leaderboard proof.

## Teleport

Authenticated clients may request a list of teleport destinations and then ask the server to approve a warp. The server owns every destination and filters custom coordinates by staff role, so hidden locations are never sent to a device until the server has verified the authenticated identity.

```json
{"type":"teleport_locations"}
{"type":"teleport_locations","destinations":[{"id":"gym:rustboro","name":"Rustboro Gym","kind":"gym"},{"id":"mom","name":"Mom's House","kind":"mom"},{"id":"player:00000000-0000-4000-8000-000000000000","name":"May","kind":"player"},{"id":"custom:00000000-0000-4000-8000-000000000001","name":"Mod rally point","kind":"custom"}],"custom_visible":true}
```

`custom_visible` is `true` only when the authenticated identity is a moderator or admin. The destination list never includes coordinates; those are returned only when the server approves an individual `teleport` request.

```json
{"type":"teleport","destination_id":"gym:rustboro"}
{"type":"teleport_result","ok":true,"map_group":3,"map_num":7,"x":8,"y":12,"facing":"down"}
```

A failed warp returns `ok:false` and a `code` such as `teleport_unauthorized`, `teleport_not_found`, or `teleport_player_unavailable`. Player destinations resolve against the current online roster and are rejected when the target has no valid state.

## Experimental Gate 4 link spike

Link transport is disabled unless the private `online.cfg` contains an eight-character room code such as `link_room=ABCD-2345`. This is a feasibility interface, not a public invitation system. It requires authenticated protocol v2 identities, admits exactly two clients, retains packets only in memory, and never stores packet contents.

The first client becomes gpSP netpacket client 0 and waits. A matching second client becomes client 1; both must advertise the exact `gpSP v1.0` netpacket protocol:

```json
{"type":"link_spike_join","room":"ABCD-2345","core":"gpSP v1.0"}
{"type":"link_waiting","room":"ABCD-2345"}
{"type":"link_started","room":"ABCD-2345","clientId":0,"peerId":1,"core":"gpSP v1.0"}
```

Before accepting `link_started`, the 3DS flushes its current save, creates and fsyncs a timestamped backup under `link-backups/`, and retains the newest three. Backup failure prevents the core netpacket session from starting.

Core packets are reliable WSS/TCP messages encoded as at most 512 bytes of hexadecimal data. A target of `65535` is broadcast; other targets are client IDs 0 through 3. The relay limits each sender to 240 packets per second and never interprets packet contents.

```json
{"type":"link_packet","to":65535,"data":"4d504b3100000000"}
{"type":"link_packet","from":0,"data":"4d504b3100000000"}
{"type":"link_leave"}
```

The room is destroyed if its host leaves. Battle/trade invitations and leaderboard completion events remain disabled until complete Cable Club battle, trade, interruption, save-integrity, public-WSS, and Old 3DS performance tests pass.

## v1 migration window

Protocol v1 `hello` remains accepted temporarily so already-installed builds continue to connect while users update. Its optional 32-hex `session` produces a stable opaque ID but is not Internet-grade authentication. The server replies with `latestVersion:2`. New builds must use v2, and v1 removal requires a separately announced compatibility gate.
