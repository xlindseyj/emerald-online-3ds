import net from 'node:net';
import crypto from 'node:crypto';

const host = process.env.GAME_HOST === '0.0.0.0' ? '127.0.0.1' : (process.env.GAME_HOST ?? '127.0.0.1');
const port = Number(process.env.GAME_PORT ?? 3210);
const healthPort = Number(process.env.HEALTH_PORT ?? 3211);
const durationMs = Number(process.env.PEER_DURATION_MS ?? 90000);
const stepMs = Number(process.env.PEER_STEP_MS ?? 650);
const peerName = process.env.PEER_NAME ?? 'Brendan';
const peerAvatar = process.env.PEER_AVATAR ?? 'boy';
const peerTargetMap = process.env.PEER_TARGET_MAP ?? '';
const peerSession = crypto.randomBytes(16).toString('hex');
if (!Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 3600000) throw new Error('PEER_DURATION_MS must be 1000-3600000');
if (!Number.isSafeInteger(stepMs) || stepMs < 250 || stepMs > 5000) throw new Error('PEER_STEP_MS must be 250-5000');
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
let target = { ...physical.state };
let position = null;
const provenTrail = [];
const send = message => socket.write(`${JSON.stringify(message)}\n`);
const sameTile = (a, b) => a && b && a.map === b.map && a.x === b.x && a.y === b.y;
const facingBetween = (from, to, fallback) => {
  if (!from || from.map !== to.map) return fallback;
  if (to.x !== from.x) return to.x > from.x ? 'right' : 'left';
  if (to.y !== from.y) return to.y > from.y ? 'down' : 'up';
  return fallback;
};
const publishPosition = next => {
  const safe = { map: next.map, x: next.x, y: next.y, facing: facingBetween(position, next, next.facing), avatar: peerAvatar };
  if (sameTile(position, safe)) return;
  position = safe;
  send({ type: 'state', seq: ++sequence, ...position });
};
const observePhysicalTile = observed => {
  const next = { map: observed.map, x: observed.x, y: observed.y, facing: observed.facing };
  if (sameTile(target, next)) { target.facing = next.facing; return; }
  const adjacent = target && target.map === next.map && Math.abs(target.x - next.x) + Math.abs(target.y - next.y) === 1;
  if (adjacent) {
    // The physical player occupied target before reaching next, so target is
    // a proven-passable tile. Follow that breadcrumb instead of inventing an
    // adjacent coordinate that may be a tree, wall, ledge, or water tile.
    provenTrail.push({ ...target });
    if (provenTrail.length > 64) provenTrail.splice(0, provenTrail.length - 64);
  } else {
    // A warp or skipped update gives us no safe intermediate path. Rebase on
    // the exact observed tile; the overlay will teleport instead of walking
    // through unobserved terrain.
    provenTrail.length = 0;
    publishPosition(next);
  }
  target = next;
};

socket.on('data', chunk => {
  buffer += chunk;
  for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.type === 'error') throw new Error(`peer rejected: ${message.code}`);
    if (message.type === 'snapshot') {
      const observed = message.players?.find(player => player.name === physical.name);
      if (observed) observePhysicalTile(observed);
    }
  }
});

await new Promise((resolve, reject) => {
  socket.once('connect', resolve);
  socket.once('error', reject);
});

send({ type: 'hello', version: 1, name: peerName, session: peerSession, avatar: peerAvatar });
// The player's current tile is the only collision-safe starting coordinate
// available without copying map data to the server. The peer begins there and
// becomes visibly one or more tiles behind as the player leaves breadcrumbs.
publishPosition(target);
setTimeout(() => send({ type: 'chat', text: `Hello from ${peerName}!` }), 1500);
setTimeout(() => send({ type: 'emote', emote: 'wave' }), 3000);

const movement = setInterval(() => {
  while (provenTrail.length && sameTile(position, provenTrail[0])) provenTrail.shift();
  if (provenTrail.length) publishPosition(provenTrail.shift());
}, stepMs);
const keepalive = setInterval(() => send({ type: 'ping', at: Date.now() }), 10000);

console.log(JSON.stringify({ ok: true, peer: peerName, joined: position.map, near: physical.name, durationMs, following: 'proven-player-tiles-only' }));
setTimeout(() => { clearInterval(movement); clearInterval(keepalive); socket.end(); }, durationMs);
await new Promise(resolve => socket.once('close', resolve));
