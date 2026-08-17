import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createPresenceServer } from '../src/server.mjs';
import { encode, MAX_LINE } from '../src/protocol.mjs';
import { MemoryTeleportStore } from '../src/teleport-store.mjs';

function connect(port) {
  return new Promise((resolve, reject) => { const s = net.createConnection({ host: '127.0.0.1', port }, () => resolve(s)); s.once('error', reject); });
}
function messages(socket) {
  let buffer = '', queue = [], wake;
  socket.on('data', c => { buffer += c; let i; while ((i = buffer.indexOf('\n')) >= 0) { queue.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1); } wake?.(); });
  return async predicate => { for (;;) { const index = queue.findIndex(predicate); if (index >= 0) return queue.splice(index, 1)[0]; await new Promise((resolve, reject) => { wake = resolve; setTimeout(() => reject(new Error('message timeout')), 1000); }); } };
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

test('global online roster includes every authenticated trainer, their coordinates, and role without widening snapshots', async t => {
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
  assert.ok(roster.users.every(user => user.role === 'player'));
  assert.deepEqual(roster.users.map(user => [user.name, user.map, user.x, user.y]), [
    ['Brendan', '0-17', 6, 9],
    ['May', '0-9', 14, 13],
    ['Wally', '2-3', 2, 6]
  ]);
  const isolated = await nextA(message => message.type === 'snapshot' && message.map === '0-9');
  assert.deepEqual(isolated.players, []);
});

import { MemoryIdentityStore } from '../src/identity-store.mjs';

test('global online roster exposes admin and moderator roles for v2 authenticated clients', async t => {
  const identityStore = new MemoryIdentityStore();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, rosterIntervalMs: 25, identityStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const adminEnrollment = await identityStore.enroll();
  const modEnrollment = await identityStore.enroll();
  identityStore.identities.get(adminEnrollment.identityId).isAdmin = true;
  identityStore.identities.get(modEnrollment.identityId).isModerator = true;
  const admin = await connect(port), moderator = await connect(port), player = await connect(port);
  t.after(() => { admin.destroy(); moderator.destroy(); player.destroy(); });
  const nextAdmin = messages(admin), nextMod = messages(moderator), nextPlayer = messages(player);
  admin.write(JSON.stringify({ type: 'hello', version: 2, name: 'Admin', identity: adminEnrollment.identityId, token: adminEnrollment.token, avatar: 'girl' }) + '\n');
  moderator.write(JSON.stringify({ type: 'hello', version: 2, name: 'Mod', identity: modEnrollment.identityId, token: modEnrollment.token, avatar: 'boy' }) + '\n');
  const playerEnrollment = await identityStore.enroll();
  player.write(JSON.stringify({ type: 'hello', version: 2, name: 'Player', identity: playerEnrollment.identityId, token: playerEnrollment.token, avatar: 'girl' }) + '\n');
  const adminWelcome = await nextAdmin(m => m.type === 'welcome');
  const modWelcome = await nextMod(m => m.type === 'welcome');
  assert.equal(adminWelcome.role, 'admin');
  assert.equal(modWelcome.role, 'moderator');
  player.write('{"type":"state","seq":1,"map":"0-0","x":0,"y":0,"facing":"down"}\n');
  const roster = await nextAdmin(message => message.type === 'online_users' && message.total === 3);
  const roles = Object.fromEntries(roster.users.map(user => [user.name, user.role]));
  assert.equal(roles.Admin, 'admin');
  assert.equal(roles.Mod, 'moderator');
  assert.equal(roles.Player, 'player');
});

test('maximum online roster page stays within the protocol line limit', () => {
  const users = Array.from({ length: 16 }, (_, index) => ({
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    name: 'ABCDEFGHIJKL', map: 'a'.repeat(32), x: 4095, y: 4095, role: 'moderator'
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

test('teleport list includes built-in destinations and online players for everyone, custom only for staff', async t => {
  const identityStore = new MemoryIdentityStore();
  const teleportStore = new MemoryTeleportStore();
  teleportStore.addCustomDestination({ id: '00000000-0000-4000-8000-000000000001', name: 'Mod Rally', map_group: 1, map_num: 2, x: 10, y: 20, facing: 'down' });
  const adminEnrollment = await identityStore.enroll();
  const modEnrollment = await identityStore.enroll();
  identityStore.identities.get(adminEnrollment.identityId).isAdmin = true;
  identityStore.identities.get(modEnrollment.identityId).isModerator = true;
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, teleportStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const admin = await connect(port), moderator = await connect(port), player = await connect(port);
  t.after(() => { admin.destroy(); moderator.destroy(); player.destroy(); });
  const nextAdmin = messages(admin), nextMod = messages(moderator), nextPlayer = messages(player);
  admin.write(JSON.stringify({ type: 'hello', version: 2, name: 'Admin', identity: adminEnrollment.identityId, token: adminEnrollment.token, avatar: 'girl' }) + '\n');
  moderator.write(JSON.stringify({ type: 'hello', version: 2, name: 'Mod', identity: modEnrollment.identityId, token: modEnrollment.token, avatar: 'boy' }) + '\n');
  const playerEnrollment = await identityStore.enroll();
  player.write(JSON.stringify({ type: 'hello', version: 2, name: 'Player', identity: playerEnrollment.identityId, token: playerEnrollment.token, avatar: 'girl' }) + '\n');
  await nextAdmin(m => m.type === 'welcome'); await nextMod(m => m.type === 'welcome'); await nextPlayer(m => m.type === 'welcome');
  player.write('{"type":"state","seq":1,"map":"route101","x":5,"y":7,"facing":"down"}\n');
  await new Promise(resolve => setTimeout(resolve, 50));

  for (const socket of [admin, moderator, player]) socket.write('{"type":"teleport_locations"}\n');
  const adminList = await nextAdmin(m => m.type === 'teleport_locations');
  const modList = await nextMod(m => m.type === 'teleport_locations');
  const playerList = await nextPlayer(m => m.type === 'teleport_locations');

  assert.ok(adminList.customVisible);
  assert.ok(modList.customVisible);
  assert.ok(!playerList.customVisible);
  assert.ok(adminList.destinations.some(d => d.kind === 'custom'));
  assert.ok(modList.destinations.some(d => d.kind === 'custom'));
  assert.ok(!playerList.destinations.some(d => d.kind === 'custom'));
  assert.ok(adminList.destinations.some(d => d.kind === 'player' && d.name === 'Player'));
  assert.ok(playerList.destinations.some(d => d.id === 'mom'));
});

test('teleport request validates role before returning coordinates', async t => {
  const identityStore = new MemoryIdentityStore();
  const teleportStore = new MemoryTeleportStore();
  teleportStore.addCustomDestination({ id: '00000000-0000-4000-8000-000000000001', name: 'Mod Rally', map_group: 1, map_num: 2, x: 10, y: 20, facing: 'down' });
  const adminEnrollment = await identityStore.enroll();
  const playerEnrollment = await identityStore.enroll();
  identityStore.identities.get(adminEnrollment.identityId).isAdmin = true;
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, teleportStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const admin = await connect(port), player = await connect(port);
  t.after(() => { admin.destroy(); player.destroy(); });
  const nextAdmin = messages(admin), nextPlayer = messages(player);
  admin.write(JSON.stringify({ type: 'hello', version: 2, name: 'Admin', identity: adminEnrollment.identityId, token: adminEnrollment.token, avatar: 'girl' }) + '\n');
  player.write(JSON.stringify({ type: 'hello', version: 2, name: 'Player', identity: playerEnrollment.identityId, token: playerEnrollment.token, avatar: 'boy' }) + '\n');
  await nextAdmin(m => m.type === 'welcome'); await nextPlayer(m => m.type === 'welcome');

  player.write('{"type":"teleport","destination_id":"custom:00000000-0000-4000-8000-000000000001"}\n');
  const playerResult = await nextPlayer(m => m.type === 'teleport_result');
  assert.ok(!playerResult.ok);
  assert.equal(playerResult.code, 'teleport_unauthorized');

  admin.write('{"type":"teleport","destination_id":"custom:00000000-0000-4000-8000-000000000001"}\n');
  const adminResult = await nextAdmin(m => m.type === 'teleport_result');
  assert.ok(adminResult.ok);
  assert.equal(adminResult.map_group, 1);
  assert.equal(adminResult.x, 10);

  player.write('{"type":"teleport","destination_id":"mom"}\n');
  const momResult = await nextPlayer(m => m.type === 'teleport_result');
  assert.ok(momResult.ok);
  assert.equal(momResult.map_num, 16);
});
