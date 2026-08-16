import net from 'node:net';

const host = process.env.GAME_HOST === '0.0.0.0' ? '127.0.0.1' : (process.env.GAME_HOST ?? '127.0.0.1');
const port = Number(process.env.GAME_PORT ?? 3210);
const healthPort = Number(process.env.HEALTH_PORT ?? 3211);
const durationMs = Number(process.env.PEER_DURATION_MS ?? 90000);
const stepMs = Number(process.env.PEER_STEP_MS ?? 650);
const peerName = process.env.PEER_NAME ?? 'Brendan';
const peerAvatar = process.env.PEER_AVATAR ?? 'boy';
if (!Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 3600000) throw new Error('PEER_DURATION_MS must be 1000-3600000');
if (!Number.isSafeInteger(stepMs) || stepMs < 250 || stepMs > 5000) throw new Error('PEER_STEP_MS must be 250-5000');
if (!/^[\x20-!#-\[\]-~]{1,12}$/.test(peerName)) throw new Error('PEER_NAME must be 1-12 safe ASCII characters');
if (!['boy', 'girl'].includes(peerAvatar)) throw new Error('PEER_AVATAR must be boy or girl');

const response = await fetch(`http://127.0.0.1:${healthPort}/debug/clients`);
if (!response.ok) throw new Error(`debug client discovery failed (${response.status}); restart the updated server`);
const discovered = await response.json();
const physical = discovered.clients.find(client => client.state && client.name !== peerName);
if (!physical) throw new Error('no positioned physical trainer is connected');

const socket = net.createConnection({ host, port });
socket.setNoDelay(true);
let buffer = '';
let sequence = 0;
let target = { ...physical.state };
let position = null;
const walkLoop = [
  { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
  { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }
];
let walkStep = 0;
const send = message => socket.write(`${JSON.stringify(message)}\n`);
const clamp = value => Math.max(0, Math.min(4095, value));
const nextPosition = () => {
  const offset = walkLoop[walkStep];
  const desired = { x: clamp(target.x + offset.x), y: clamp(target.y + offset.y) };
  if (!position || position.map !== target.map) return { map: target.map, ...desired, facing: 'left' };
  const dx = desired.x - position.x;
  const dy = desired.y - position.y;
  if (dx) return { map: target.map, x: position.x + Math.sign(dx), y: position.y, facing: dx > 0 ? 'right' : 'left' };
  if (dy) return { map: target.map, x: position.x, y: position.y + Math.sign(dy), facing: dy > 0 ? 'down' : 'up' };
  return { ...position, facing: target.facing };
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
      if (observed) target = { map: observed.map, x: observed.x, y: observed.y, facing: observed.facing };
    }
  }
});

await new Promise((resolve, reject) => {
  socket.once('connect', resolve);
  socket.once('error', reject);
});

send({ type: 'hello', version: 1, name: peerName, session: 'b7e4d29c468f40b8a47cae2d053db124', avatar: peerAvatar });
position = nextPosition();
send({ type: 'state', seq: ++sequence, ...position, avatar: peerAvatar });
setTimeout(() => send({ type: 'chat', text: `Hello from ${peerName}!` }), 1500);
setTimeout(() => send({ type: 'emote', emote: 'wave' }), 3000);

const movement = setInterval(() => {
  walkStep = (walkStep + 1) % walkLoop.length;
  position = nextPosition();
  send({ type: 'state', seq: ++sequence, ...position, avatar: peerAvatar });
}, stepMs);
const keepalive = setInterval(() => send({ type: 'ping', at: Date.now() }), 10000);

console.log(JSON.stringify({ ok: true, peer: peerName, joined: position.map, near: physical.name, durationMs, following: true }));
setTimeout(() => { clearInterval(movement); clearInterval(keepalive); socket.end(); }, durationMs);
await new Promise(resolve => socket.once('close', resolve));
