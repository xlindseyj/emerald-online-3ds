import net from 'node:net';

const host = process.env.GAME_HOST === '0.0.0.0' ? '127.0.0.1' : (process.env.GAME_HOST ?? '127.0.0.1');
const port = Number(process.env.GAME_PORT ?? 3210);
const healthPort = Number(process.env.HEALTH_PORT ?? 3211);
const durationMs = Number(process.env.PEER_DURATION_MS ?? 90000);

const response = await fetch(`http://127.0.0.1:${healthPort}/debug/clients`);
if (!response.ok) throw new Error(`debug client discovery failed (${response.status}); restart the updated server`);
const discovered = await response.json();
const physical = discovered.clients.find(client => client.state);
if (!physical) throw new Error('no positioned physical trainer is connected');

const socket = net.createConnection({ host, port });
socket.setNoDelay(true);
let buffer = '';
let sequence = 0;
const position = { ...physical.state };
const origin = { x: physical.state.x + 1, y: physical.state.y };
const walkLoop = [
  { x: origin.x,     y: origin.y,     facing: 'left' },
  { x: origin.x,     y: origin.y + 1, facing: 'down' },
  { x: origin.x - 1, y: origin.y + 1, facing: 'left' },
  { x: origin.x - 1, y: origin.y,     facing: 'up' },
  { x: origin.x,     y: origin.y,     facing: 'right' },
];
let walkStep = 0;
const send = message => socket.write(`${JSON.stringify(message)}\n`);

socket.on('data', chunk => {
  buffer += chunk;
  for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) process.stdout.write(`server ${line}\n`);
  }
});

await new Promise((resolve, reject) => {
  socket.once('connect', resolve);
  socket.once('error', reject);
});

send({ type: 'hello', version: 1, name: 'Brendan', session: 'b7e4d29c468f40b8a47cae2d053db124', avatar: 'boy' });
send({ type: 'state', seq: ++sequence, map: position.map, ...walkLoop[walkStep], avatar: 'boy' });
setTimeout(() => send({ type: 'chat', text: 'Hello from Brendan!' }), 1500);
setTimeout(() => send({ type: 'emote', emote: 'wave' }), 3000);

const movement = setInterval(() => {
  walkStep = (walkStep + 1) % walkLoop.length;
  send({ type: 'state', seq: ++sequence, map: position.map, ...walkLoop[walkStep], avatar: 'boy' });
  send({ type: 'ping', at: Date.now() });
}, 2000);

console.log(JSON.stringify({ ok: true, peer: 'Brendan', joined: position.map, near: physical.name, durationMs }));
setTimeout(() => { clearInterval(movement); socket.end(); }, durationMs);
await new Promise(resolve => socket.once('close', resolve));
