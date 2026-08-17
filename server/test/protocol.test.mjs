import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createPresenceServer } from '../src/server.mjs';
import { encode, MAX_LINE } from '../src/protocol.mjs';

function connect(port) {
  return new Promise((resolve, reject) => { const s = net.createConnection({ host: '127.0.0.1', port }, () => resolve(s)); s.once('error', reject); });
}
function messages(socket) {
  let buffer = '', queue = [], wake;
  socket.on('data', c => { buffer += c; let i; while ((i = buffer.indexOf('\n')) >= 0) { queue.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1); } wake?.(); });
  return async predicate => { for (;;) { const found = queue.find(predicate); if (found) return found; await new Promise((resolve, reject) => { wake = resolve; setTimeout(() => reject(new Error('message timeout')), 1000); }); } };
}

test('two trainers receive same-map presence and map isolation', async t => {
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0 });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, a = await connect(port), b = await connect(port); t.after(() => { a.destroy(); b.destroy(); });
  const nextA = messages(a), nextB = messages(b);
  a.write('{"type":"hello","version":1,"name":"May","avatar":"girl"}\n'); b.write('{"type":"hello","version":1,"name":"Brendan","avatar":"boy"}\n');
  await nextA(m => m.type === 'welcome'); await nextB(m => m.type === 'welcome');
  a.write('{"type":"state","seq":1,"map":"route101","x":1,"y":2,"facing":"down","avatar":"girl"}\n');
  b.write('{"type":"state","seq":1,"map":"route101","x":4,"y":5,"facing":"up","avatar":"boy"}\n');
  const visible = await nextA(m => m.type === 'snapshot' && m.players.length === 1);
  assert.equal(visible.players[0].name, 'Brendan'); assert.equal(visible.players[0].x, 4); assert.equal(visible.players[0].avatar, 'boy');
  b.write('{"type":"state","seq":2,"map":"littleroot","x":4,"y":5,"facing":"up"}\n');
  const isolated = await nextA(m => m.type === 'snapshot' && m.players.length === 0);
  assert.deepEqual(isolated.players, []);
});

test('global online roster includes every authenticated trainer and their coordinates without widening snapshots', async t => {
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, rosterIntervalMs: 25 });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, a = await connect(port), b = await connect(port), c = await connect(port);
  t.after(() => { a.destroy(); b.destroy(); c.destroy(); });
  const nextA = messages(a), nextB = messages(b), nextC = messages(c);
  a.write('{"type":"hello","version":1,"name":"May"}\n');
  b.write('{"type":"hello","version":1,"name":"Brendan"}\n');
  c.write('{"type":"hello","version":1,"name":"Wally"}\n');
  await nextA(m => m.type === 'welcome'); await nextB(m => m.type === 'welcome'); await nextC(m => m.type === 'welcome');
  a.write('{"type":"state","seq":1,"map":"0-9","x":14,"y":13,"facing":"down"}\n');
  b.write('{"type":"state","seq":1,"map":"0-17","x":6,"y":9,"facing":"up"}\n');
  c.write('{"type":"state","seq":1,"map":"2-3","x":2,"y":6,"facing":"left"}\n');
  const roster = await nextA(message => message.type === 'online_users' && message.total === 3 && message.users.every(user => user.x >= 0));
  assert.equal(roster.pages, 1);
  assert.deepEqual(roster.users.map(user => [user.name, user.map, user.x, user.y]), [
    ['Brendan', '0-17', 6, 9],
    ['May', '0-9', 14, 13],
    ['Wally', '2-3', 2, 6]
  ]);
  const isolated = await nextA(message => message.type === 'snapshot' && message.map === '0-9');
  assert.deepEqual(isolated.players, []);
});

test('maximum online roster page stays within the protocol line limit', () => {
  const users = Array.from({ length: 16 }, (_, index) => ({
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    name: 'ABCDEFGHIJKL', map: 'a'.repeat(32), x: 4095, y: 4095
  }));
  const line = encode({ type: 'online_users', page: 3, pages: 4, total: 64, users });
  assert.ok(Buffer.byteLength(line.slice(0, -1)) <= MAX_LINE);
});

test('rejects state before hello', async t => {
  const { server } = createPresenceServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const s = await connect(server.address().port); t.after(() => s.destroy()); const next = messages(s);
  s.write('{"type":"state","seq":1,"map":"x","x":1,"y":1,"facing":"up"}\n');
  assert.equal((await next(m => m.type === 'error')).code, 'invalid_hello');
});

test('map chat stays map-local and global chat reaches all authenticated trainers', async t => {
  const { server } = createPresenceServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, a = await connect(port), b = await connect(port), c = await connect(port);
  t.after(() => { a.destroy(); b.destroy(); c.destroy(); });
  const nextA = messages(a), nextB = messages(b), nextC = messages(c);
  a.write('{"type":"hello","version":1,"name":"May"}\n'); b.write('{"type":"hello","version":1,"name":"Brendan"}\n'); c.write('{"type":"hello","version":1,"name":"Wally"}\n');
  await nextA(m => m.type === 'welcome'); await nextB(m => m.type === 'welcome'); await nextC(m => m.type === 'welcome');
  a.write('{"type":"state","seq":1,"map":"route101","x":1,"y":2,"facing":"down"}\n');
  b.write('{"type":"state","seq":1,"map":"route101","x":4,"y":5,"facing":"up"}\n');
  c.write('{"type":"state","seq":1,"map":"littleroot","x":4,"y":5,"facing":"up"}\n');
  await nextA(m => m.type === 'snapshot'); await nextB(m => m.type === 'snapshot'); await nextC(m => m.type === 'snapshot');
  a.write('{"type":"chat","text":"Meet by the grass!"}\n');
  const delivered = await nextA(m => m.type === 'chat');
  assert.equal(delivered.text, 'Meet by the grass!');
  assert.equal(delivered.scope, 'map');
  assert.match(delivered.sentAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal((await nextB(m => m.type === 'chat')).name, 'May');
  a.write('{"type":"chat","text":"too fast"}\n');
  assert.equal((await nextA(m => m.code === 'chat_rate_limited')).type, 'error');
  c.write('{"type":"chat","text":"Town only"}\n');
  assert.equal((await nextC(m => m.type === 'chat')).text, 'Town only');
  await new Promise(resolve => setTimeout(resolve, 1050));
  a.write('{"type":"chat","scope":"global","text":"Hello everyone!"}\n');
  assert.equal((await nextA(m => m.type === 'chat' && m.scope === 'global')).text, 'Hello everyone!');
  assert.equal((await nextB(m => m.type === 'chat' && m.scope === 'global')).name, 'May');
  assert.equal((await nextC(m => m.type === 'chat' && m.scope === 'global')).map, 'route101');
  await new Promise(resolve => setTimeout(resolve, 1050));
  a.write('{"type":"chat","scope":"nearby","text":"invalid scope"}\n');
  assert.equal((await nextA(m => m.code === 'invalid_chat')).type, 'error');
});

test('emotes are allowlisted, rate limited, and isolated by map', async t => {
  const { server } = createPresenceServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, a = await connect(port), b = await connect(port), c = await connect(port);
  t.after(() => { a.destroy(); b.destroy(); c.destroy(); });
  const nextA = messages(a), nextB = messages(b), nextC = messages(c);
  a.write('{"type":"hello","version":1,"name":"May"}\n'); b.write('{"type":"hello","version":1,"name":"Brendan"}\n'); c.write('{"type":"hello","version":1,"name":"Wally"}\n');
  await nextA(m => m.type === 'welcome'); await nextB(m => m.type === 'welcome'); await nextC(m => m.type === 'welcome');
  a.write('{"type":"state","seq":1,"map":"route101","x":1,"y":2,"facing":"down"}\n');
  b.write('{"type":"state","seq":1,"map":"route101","x":4,"y":5,"facing":"up"}\n');
  c.write('{"type":"state","seq":1,"map":"littleroot","x":4,"y":5,"facing":"up"}\n');
  await nextA(m => m.type === 'snapshot'); await nextB(m => m.type === 'snapshot'); await nextC(m => m.type === 'snapshot');
  a.write('{"type":"emote","emote":"wave"}\n');
  assert.equal((await nextA(m => m.type === 'emote')).emote, 'wave');
  assert.equal((await nextB(m => m.type === 'emote')).name, 'May');
  a.write('{"type":"emote","emote":"battle"}\n');
  assert.equal((await nextA(m => m.code === 'emote_rate_limited')).type, 'error');
  c.write('{"type":"emote","emote":"dance"}\n');
  assert.equal((await nextC(m => m.code === 'invalid_emote')).type, 'error');
});

test('session token keeps identity stable and replaces duplicate connection', async t => {
  const { server } = createPresenceServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, first = await connect(port); t.after(() => first.destroy());
  const nextFirst = messages(first);
  const session = '0123456789abcdef0123456789abcdef';
  first.write(`${JSON.stringify({ type: 'hello', version: 1, name: 'May', session })}\n`);
  const firstWelcome = await nextFirst(m => m.type === 'welcome');

  const replacement = await connect(port); t.after(() => replacement.destroy());
  const nextReplacement = messages(replacement);
  replacement.write(`${JSON.stringify({ type: 'hello', version: 1, name: 'May', session })}\n`);
  const replacementWelcome = await nextReplacement(m => m.type === 'welcome');
  assert.equal(replacementWelcome.id, firstWelcome.id);
  assert.equal((await nextFirst(m => m.code === 'session_replaced')).type, 'error');

  const invalid = await connect(port); t.after(() => invalid.destroy()); const nextInvalid = messages(invalid);
  invalid.write('{"type":"hello","version":1,"name":"May","session":"not-a-token"}\n');
  assert.equal((await nextInvalid(m => m.code === 'invalid_hello')).type, 'error');
});

test('connection cap rejects excess clients and reports metrics', async t => {
  const presence = createPresenceServer({ maxConnections: 1 });
  await new Promise(r => presence.server.listen(0, '127.0.0.1', r)); t.after(() => presence.server.close());
  const first = await connect(presence.server.address().port); t.after(() => first.destroy());
  const excess = await connect(presence.server.address().port); t.after(() => excess.destroy());
  const nextExcess = messages(excess);
  assert.equal((await nextExcess(m => m.code === 'server_full')).type, 'error');
  assert.equal(presence.status().connections, 1);
  assert.equal(presence.status().totalConnections, 2);
  assert.equal(presence.status().rejectedConnections, 1);
});

test('per-IP cap prevents one address from consuming every slot', async t => {
  const presence = createPresenceServer({ maxConnections: 8, maxConnectionsPerIp: 1 });
  await new Promise(r => presence.server.listen(0, '127.0.0.1', r)); t.after(() => presence.server.close());
  const first = await connect(presence.server.address().port); t.after(() => first.destroy());
  const excess = await connect(presence.server.address().port); t.after(() => excess.destroy());
  const nextExcess = messages(excess);
  assert.equal((await nextExcess(m => m.code === 'ip_connection_limit')).type, 'error');
  assert.equal(presence.status().ipRejectedConnections, 1);
});

test('unauthenticated sockets are closed after the hello deadline', async t => {
  const presence = createPresenceServer({ helloTimeoutMs: 25 });
  await new Promise(r => presence.server.listen(0, '127.0.0.1', r)); t.after(() => presence.server.close());
  const idle = await connect(presence.server.address().port); t.after(() => idle.destroy());
  const nextIdle = messages(idle);
  assert.equal((await nextIdle(m => m.code === 'hello_timeout')).type, 'error');
  assert.equal(presence.status().helloTimeouts, 1);
});
