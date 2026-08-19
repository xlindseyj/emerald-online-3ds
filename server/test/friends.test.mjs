import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createPresenceServer } from '../src/server.mjs';
import { MemoryIdentityStore } from '../src/identity-store.mjs';
import { MemoryFriendStore } from '../src/friend-store.mjs';

function connect(port) {
  return new Promise((resolve, reject) => { const s = net.createConnection({ host: '127.0.0.1', port }, () => resolve(s)); s.once('error', reject); });
}
function messages(socket) {
  let buffer = '', queue = [], wake;
  socket.on('data', c => { buffer += c; let i; while ((i = buffer.indexOf('\n')) >= 0) { queue.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1); } wake?.(); });
  return async predicate => { for (;;) { const index = queue.findIndex(predicate); if (index >= 0) return queue.splice(index, 1)[0]; await new Promise((resolve, reject) => { wake = resolve; setTimeout(() => reject(new Error('message timeout')), 1000); }); } };
}

async function enrollAndConnect(port, identityStore, name) {
  const enrollment = await identityStore.enroll();
  const s = await connect(port);
  const next = messages(s);
  s.write(JSON.stringify({ type: 'hello', version: 2, name, identity: enrollment.identityId, token: enrollment.token }) + '\n');
  await next(m => m.type === 'welcome');
  return { socket: s, next, enrollment };
}

test('friend_list is empty for a new trainer', async t => {
  const identityStore = new MemoryIdentityStore();
  const friendStore = new MemoryFriendStore(fingerprint => identityStore.findByFingerprint(fingerprint));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, friendStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const { socket: s, next } = await enrollAndConnect(port, identityStore, 'May');
  t.after(() => s.destroy());
  s.write('{"type":"friend_list"}\n');
  const list = await next(m => m.type === 'friend_list');
  assert.deepEqual(list.friends, []);
});

test('friend_request creates a pending request', async t => {
  const identityStore = new MemoryIdentityStore();
  const friendStore = new MemoryFriendStore(fingerprint => identityStore.findByFingerprint(fingerprint));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, friendStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const a = await enrollAndConnect(port, identityStore, 'May');
  const b = await enrollAndConnect(port, identityStore, 'Brendan');
  t.after(() => { a.socket.destroy(); b.socket.destroy(); });
  a.socket.write(JSON.stringify({ type: 'friend_request', fingerprint: b.enrollment.fingerprint }) + '\n');
  const result = await a.next(m => m.type === 'friend_result');
  assert.equal(result.fingerprint, b.enrollment.fingerprint);
  assert.equal(result.status, 'pending');
});

test('friend_accept turns a pending request into an accepted friendship', async t => {
  const identityStore = new MemoryIdentityStore();
  const friendStore = new MemoryFriendStore(fingerprint => identityStore.findByFingerprint(fingerprint));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, friendStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const a = await enrollAndConnect(port, identityStore, 'May');
  const b = await enrollAndConnect(port, identityStore, 'Brendan');
  t.after(() => { a.socket.destroy(); b.socket.destroy(); });
  a.socket.write(JSON.stringify({ type: 'friend_request', fingerprint: b.enrollment.fingerprint }) + '\n');
  await a.next(m => m.type === 'friend_result' && m.status === 'pending');
  b.socket.write(JSON.stringify({ type: 'friend_accept', fingerprint: a.enrollment.fingerprint }) + '\n');
  const accepted = await b.next(m => m.type === 'friend_result');
  assert.equal(accepted.status, 'accepted');
});

test('reciprocal friend_request auto-accepts', async t => {
  const identityStore = new MemoryIdentityStore();
  const friendStore = new MemoryFriendStore(fingerprint => identityStore.findByFingerprint(fingerprint));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, friendStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const a = await enrollAndConnect(port, identityStore, 'May');
  const b = await enrollAndConnect(port, identityStore, 'Brendan');
  t.after(() => { a.socket.destroy(); b.socket.destroy(); });
  a.socket.write(JSON.stringify({ type: 'friend_request', fingerprint: b.enrollment.fingerprint }) + '\n');
  await a.next(m => m.type === 'friend_result' && m.status === 'pending');
  b.socket.write(JSON.stringify({ type: 'friend_request', fingerprint: a.enrollment.fingerprint }) + '\n');
  const result = await b.next(m => m.type === 'friend_result');
  assert.equal(result.status, 'accepted');
});

test('friend_remove deletes the friendship', async t => {
  const identityStore = new MemoryIdentityStore();
  const friendStore = new MemoryFriendStore(fingerprint => identityStore.findByFingerprint(fingerprint));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, friendStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const a = await enrollAndConnect(port, identityStore, 'May');
  const b = await enrollAndConnect(port, identityStore, 'Brendan');
  t.after(() => { a.socket.destroy(); b.socket.destroy(); });
  a.socket.write(JSON.stringify({ type: 'friend_request', fingerprint: b.enrollment.fingerprint }) + '\n');
  await a.next(m => m.type === 'friend_result' && m.status === 'pending');
  b.socket.write(JSON.stringify({ type: 'friend_accept', fingerprint: a.enrollment.fingerprint }) + '\n');
  await b.next(m => m.type === 'friend_result' && m.status === 'accepted');
  a.socket.write(JSON.stringify({ type: 'friend_remove', fingerprint: b.enrollment.fingerprint }) + '\n');
  const removed = await a.next(m => m.type === 'friend_removed');
  assert.equal(removed.fingerprint, b.enrollment.fingerprint);
  const list = await friendStore.listFriends(a.enrollment.identityId);
  assert.equal(list.length, 0);
});

test('friend_list shows online friends with names and positions', async t => {
  const identityStore = new MemoryIdentityStore();
  const friendStore = new MemoryFriendStore(fingerprint => identityStore.findByFingerprint(fingerprint));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, friendStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const a = await enrollAndConnect(port, identityStore, 'May');
  const b = await enrollAndConnect(port, identityStore, 'Brendan');
  t.after(() => { a.socket.destroy(); b.socket.destroy(); });
  a.socket.write(JSON.stringify({ type: 'friend_request', fingerprint: b.enrollment.fingerprint }) + '\n');
  await a.next(m => m.type === 'friend_result' && m.status === 'pending');
  b.socket.write(JSON.stringify({ type: 'friend_accept', fingerprint: a.enrollment.fingerprint }) + '\n');
  await b.next(m => m.type === 'friend_result' && m.status === 'accepted');
  b.socket.write('{"type":"state","seq":1,"map":"0-9","x":5,"y":7,"facing":"down"}\n');
  a.socket.write('{"type":"friend_list"}\n');
  const list = await a.next(m => m.type === 'friend_list');
  assert.equal(list.friends.length, 1);
  assert.equal(list.friends[0].name, 'Brendan');
  assert.equal(list.friends[0].online, true);
  assert.equal(list.friends[0].map, '0-9');
  assert.equal(list.friends[0].x, 5);
  assert.equal(list.friends[0].y, 7);
});
