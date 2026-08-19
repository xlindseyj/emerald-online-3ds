import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createPresenceServer } from '../src/server.mjs';
import { MemoryIdentityStore } from '../src/identity-store.mjs';
import { MemoryTitleStore } from '../src/title-store.mjs';

function connect(port) {
  return new Promise((resolve, reject) => { const s = net.createConnection({ host: '127.0.0.1', port }, () => resolve(s)); s.once('error', reject); });
}
function messages(socket) {
  let buffer = '', queue = [], wake;
  socket.on('data', c => { buffer += c; let i; while ((i = buffer.indexOf('\n')) >= 0) { queue.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1); } wake?.(); });
  return async predicate => { for (;;) { const index = queue.findIndex(predicate); if (index >= 0) return queue.splice(index, 1)[0]; await new Promise((resolve, reject) => { wake = resolve; setTimeout(() => reject(new Error('message timeout')), 1000); }); } };
}

async function authenticate(s, identityStore) {
  const enrollment = await identityStore.enroll();
  const next = messages(s);
  s.write(JSON.stringify({ type: 'hello', version: 2, name: 'May', identity: enrollment.identityId, token: enrollment.token }) + '\n');
  await next(m => m.type === 'welcome');
  return { next, enrollment };
}

test('title_list is empty for a new trainer', async t => {
  const identityStore = new MemoryIdentityStore();
  const titleStore = new MemoryTitleStore();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, titleStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const { next } = await authenticate(s, identityStore);
  s.write('{"type":"title_list"}\n');
  const list = await next(m => m.type === 'title_list');
  assert.deepEqual(list.titles, []);
});

test('title is unlocked and equipped through the title store', async t => {
  const identityStore = new MemoryIdentityStore();
  const titleStore = new MemoryTitleStore();
  const enrollment = await identityStore.enroll();
  await titleStore.unlockTitle(enrollment.identityId, 'Beta Pioneer');
  const equipped = await titleStore.getEquippedTitle(enrollment.identityId);
  assert.equal(equipped, 'Beta Pioneer');
  const list = await titleStore.listTitles(enrollment.identityId);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Beta Pioneer');
  assert.equal(list[0].equipped, true);
});

test('title_equip switches the equipped title', async t => {
  const identityStore = new MemoryIdentityStore();
  const titleStore = new MemoryTitleStore();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, titleStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const { next, enrollment } = await authenticate(s, identityStore);
  await titleStore.unlockTitle(enrollment.identityId, 'Beta Pioneer');
  await titleStore.unlockTitle(enrollment.identityId, 'Hoenn Hero');
  s.write('{"type":"title_equip","title":"Hoenn Hero"}\n');
  const result = await next(m => m.type === 'title_equipped');
  assert.equal(result.title, 'Hoenn Hero');
  const equipped = await titleStore.getEquippedTitle(enrollment.identityId);
  assert.equal(equipped, 'Hoenn Hero');
});

test('title_equip rejects an unowned title', async t => {
  const identityStore = new MemoryIdentityStore();
  const titleStore = new MemoryTitleStore();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, titleStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const { next } = await authenticate(s, identityStore);
  s.write('{"type":"title_equip","title":"Not Mine"}\n');
  const err = await next(m => m.type === 'error');
  assert.equal(err.code, 'title_not_owned');
});

test('title appears in welcome and online roster', async t => {
  const identityStore = new MemoryIdentityStore();
  const titleStore = new MemoryTitleStore();
  const enrollment = await identityStore.enroll();
  await titleStore.unlockTitle(enrollment.identityId, 'Beta Pioneer');
  await titleStore.equipTitle(enrollment.identityId, 'Beta Pioneer');
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, titleStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const next = messages(s);
  s.write(JSON.stringify({ type: 'hello', version: 2, name: 'May', identity: enrollment.identityId, token: enrollment.token }) + '\n');
  const welcome = await next(m => m.type === 'welcome');
  assert.equal(welcome.title, 'Beta Pioneer');
});
