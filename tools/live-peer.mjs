import net from 'node:net';
import crypto from 'node:crypto';

const host = process.env.GAME_HOST === '0.0.0.0' ? '127.0.0.1' : (process.env.GAME_HOST ?? '127.0.0.1');
const port = Number(process.env.GAME_PORT ?? 3210);
const healthPort = Number(process.env.HEALTH_PORT ?? 3211);
const durationMs = Number(process.env.PEER_DURATION_MS ?? 90000);
const peerName = process.env.PEER_NAME ?? 'Brendan';
const peerAvatar = process.env.PEER_AVATAR ?? 'boy';
const peerTargetMap = process.env.PEER_TARGET_MAP ?? '';
const peerSession = crypto.randomBytes(16).toString('hex');
if (!Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 3600000) throw new Error('PEER_DURATION_MS must be 1000-3600000');
if (!/^[\x20-!#-\[\]-~]{1,12}$/.test(peerName)) throw new Error('PEER_NAME must be 1-12 safe ASCII characters');
if (!['boy', 'girl'].includes(peerAvatar)) throw new Error('PEER_AVATAR must be boy or girl');
if (peerTargetMap && !/^[A-Za-z0-9_-]{1,32}$/.test(peerTargetMap)) throw new Error('PEER_TARGET_MAP must be a safe map identifier');

const response = await fetch(`http://127.0.0.1:${healthPort}/debug/clients`);
if (!response.ok) throw new Error(`debug client discovery failed (${response.status}); restart the updated server`);
const discovered = await response.json();
const physical = discovered.clients.find(client => client.state && client.name !== peerName && (!peerTargetMap || client.state.map === peerTargetMap));
if (!physical) throw new Error(peerTargetMap ? `no positioned trainer is connected on ${peerTargetMap}` : 'no positioned physical trainer is connected');

const socket = net.createConnection({ host, port });
socket.setNoDelay(true);
let buffer = '';
let sequence = 0;
let position = null;
const send = message => socket.write(`${JSON.stringify(message)}\n`);
const publishPosition = next => {
  position = { map: next.map, x: next.x, y: next.y, facing: next.facing, avatar: peerAvatar };
  send({ type: 'state', seq: ++sequence, ...position });
};

socket.on('data', chunk => {
  buffer += chunk;
  for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.type === 'error') throw new Error(`peer rejected: ${message.code}`);
  }
});

await new Promise((resolve, reject) => {
  socket.once('connect', resolve);
  socket.once('error', reject);
});

send({ type: 'hello', version: 1, name: peerName, session: peerSession, avatar: peerAvatar });
// A coordinate alone does not describe collision, surfing, elevation, object
// priority, or foreground occlusion. Use the real player's exact starting tile
// and remain stationary; moving synthetic overlays require richer game state or
// a real second client and must not infer a path from coordinate history.
publishPosition(physical.state);
setTimeout(() => send({ type: 'chat', text: `Hello from ${peerName}!` }), 1500);
setTimeout(() => send({ type: 'emote', emote: 'wave' }), 3000);

const keepalive = setInterval(() => send({ type: 'ping', at: Date.now() }), 10000);

console.log(JSON.stringify({ ok: true, peer: peerName, joined: position.map, near: physical.name, durationMs, movement: 'stationary-exact-start-tile' }));
setTimeout(() => { clearInterval(keepalive); socket.end(); }, durationMs);
await new Promise(resolve => socket.once('close', resolve));
