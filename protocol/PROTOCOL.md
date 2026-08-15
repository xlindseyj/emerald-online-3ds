# Presence protocol v1

The application protocol is UTF-8 newline-delimited JSON. A line may not exceed 4096 bytes. Clients must send `hello` first. The public 3DS transport is an authenticated WebSocket at `wss://pokemon-server.lws-workspace.com/game`; the raw TCP listener remains cluster-internal and may be selected with `transport=tcp` for trusted LAN development.

Client messages:

```json
{"type":"hello","version":1,"name":"May","session":"0123456789abcdef0123456789abcdef","avatar":"girl"}
{"type":"state","seq":1,"map":"littleroot","x":12,"y":8,"facing":"down","avatar":"girl"}
{"type":"chat","text":"Hello!"}
{"type":"emote","emote":"wave"}
{"type":"ping","at":1234}
```

Server messages include `welcome` (assigned opaque id), `snapshot` (players in the sender's map), `chat`, `emote`, `pong`, and `error`. Coordinates are integer tile coordinates from 0 through 4095. Names are 1-12 printable ASCII characters. Chat is 1-80 printable ASCII characters; quotes and backslashes are excluded in v1. Chat is delivered only to trainers in the sender's current map and limited to one message per second. Emotes are allowlisted as `wave`, `battle`, `trade`, or `gg`, delivered only within the current map, and limited to one every two seconds. Facing is `up`, `down`, `left`, or `right`. Sequence numbers must increase.

`hello.session` is an optional private 32-digit hexadecimal token. When present, the server derives the same opaque public trainer ID after reconnects and replaces an older connection using that token. Legacy clients without a session remain supported but receive a new random ID on every connection. The token is never included in snapshots or other broadcasts. It is a reconnect identity, not secure Internet authentication; public deployments still require TLS and account credentials.

Clients should send a `ping` at least every 20 seconds while stationary. The 3DS runtime uses a 10-second interval and automatically reconnects after transient failures. A reconnect starts a new session and therefore sends `hello` followed by the current state even if the player has not moved. Deliberately selecting offline mode suppresses reconnect attempts.

`avatar` is optional for v1 compatibility and is either `boy` or `girl`. The 3DS runtime derives it from Emerald's SaveBlock2 player gender. Clients use their own private sprite atlas to render the matching authentic Brendan or May walking frames; sprite pixels are never sent through the protocol.

Snapshots are presence hints, not authoritative save data. Clients must not trust them for battles, trades, inventory, or progression.
