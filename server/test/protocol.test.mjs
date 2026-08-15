import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createPresenceServer } from '../src/server.mjs';

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

test('rejects state before hello', async t => {
  const { server } = createPresenceServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const s = await connect(server.address().port); t.after(() => s.destroy()); const next = messages(s);
  s.write('{"type":"state","seq":1,"map":"x","x":1,"y":1,"facing":"up"}\n');
  assert.equal((await next(m => m.type === 'error')).code, 'invalid_hello');
});

test('chat is delivered only to trainers in the same map', async t => {
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
  assert.equal((await nextA(m => m.type === 'chat')).text, 'Meet by the grass!');
  assert.equal((await nextB(m => m.type === 'chat')).name, 'May');
  a.write('{"type":"chat","text":"too fast"}\n');
  assert.equal((await nextA(m => m.code === 'chat_rate_limited')).type, 'error');
  c.write('{"type":"chat","text":"Town only"}\n');
  assert.equal((await nextC(m => m.type === 'chat')).text, 'Town only');
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
