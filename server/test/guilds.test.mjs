import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createPresenceServer } from '../src/server.mjs';
import { MemoryIdentityStore } from '../src/identity-store.mjs';
import { MemoryGuildStore } from '../src/guild-store.mjs';

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

test('guild_info is null for a trainer not in a guild', async t => {
  const identityStore = new MemoryIdentityStore();
  const guildStore = new MemoryGuildStore(fp => identityStore.findByFingerprint(fp));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, guildStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const { socket: s, next } = await enrollAndConnect(port, identityStore, 'May');
  t.after(() => s.destroy());
  s.write('{"type":"guild_info"}\n');
  const info = await next(m => m.type === 'guild_info');
  assert.equal(info.guild, null);
});

test('guild_create forms a guild and makes the creator leader', async t => {
  const identityStore = new MemoryIdentityStore();
  const guildStore = new MemoryGuildStore(fp => identityStore.findByFingerprint(fp));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, guildStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const { socket: s, next, enrollment } = await enrollAndConnect(port, identityStore, 'May');
  t.after(() => s.destroy());
  s.write('{"type":"guild_create","name":"Hoenn Heroes","tag":"HH"}\n');
  const info = await next(m => m.type === 'guild_info');
  assert.equal(info.guild.name, 'Hoenn Heroes');
  assert.equal(info.guild.tag, 'HH');
  assert.equal(info.guild.members.length, 1);
  assert.equal(info.guild.members[0].identity_id, enrollment.identityId);
  assert.equal(info.guild.members[0].role, 'leader');
});

test('guild_join lets a second trainer join by name', async t => {
  const identityStore = new MemoryIdentityStore();
  const guildStore = new MemoryGuildStore(fp => identityStore.findByFingerprint(fp));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, guildStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const a = await enrollAndConnect(port, identityStore, 'May');
  const b = await enrollAndConnect(port, identityStore, 'Brendan');
  t.after(() => { a.socket.destroy(); b.socket.destroy(); });
  a.socket.write('{"type":"guild_create","name":"Hoenn Heroes","tag":"HH"}\n');
  await a.next(m => m.type === 'guild_info');
  b.socket.write('{"type":"guild_join","name":"Hoenn Heroes"}\n');
  const info = await b.next(m => m.type === 'guild_info');
  assert.equal(info.guild.members.length, 2);
});

test('a trainer can only belong to one guild', async t => {
  const identityStore = new MemoryIdentityStore();
  const guildStore = new MemoryGuildStore(fp => identityStore.findByFingerprint(fp));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, guildStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const a = await enrollAndConnect(port, identityStore, 'May');
  const b = await enrollAndConnect(port, identityStore, 'Brendan');
  t.after(() => { a.socket.destroy(); b.socket.destroy(); });
  a.socket.write('{"type":"guild_create","name":"First Guild","tag":"FG"}\n');
  await a.next(m => m.type === 'guild_info');
  b.socket.write('{"type":"guild_create","name":"Second Guild","tag":"SG"}\n');
  await b.next(m => m.type === 'guild_info');
  a.socket.write('{"type":"guild_join","name":"Second Guild"}\n');
  const err = await a.next(m => m.type === 'error');
  assert.equal(err.code, 'already_in_guild');
});

test('guild_leave removes a member but not the leader', async t => {
  const identityStore = new MemoryIdentityStore();
  const guildStore = new MemoryGuildStore(fp => identityStore.findByFingerprint(fp));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, guildStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const a = await enrollAndConnect(port, identityStore, 'May');
  const b = await enrollAndConnect(port, identityStore, 'Brendan');
  t.after(() => { a.socket.destroy(); b.socket.destroy(); });
  a.socket.write('{"type":"guild_create","name":"Hoenn Heroes","tag":"HH"}\n');
  await a.next(m => m.type === 'guild_info');
  b.socket.write('{"type":"guild_join","name":"Hoenn Heroes"}\n');
  await b.next(m => m.type === 'guild_info');
  b.socket.write('{"type":"guild_leave"}\n');
  const left = await b.next(m => m.type === 'guild_left');
  assert.ok(left);
  b.socket.write('{"type":"guild_info"}\n');
  const info = await b.next(m => m.type === 'guild_info');
  assert.equal(info.guild, null);
});

test('guild_disband removes all members', async t => {
  const identityStore = new MemoryIdentityStore();
  const guildStore = new MemoryGuildStore(fp => identityStore.findByFingerprint(fp));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, guildStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const a = await enrollAndConnect(port, identityStore, 'May');
  const b = await enrollAndConnect(port, identityStore, 'Brendan');
  t.after(() => { a.socket.destroy(); b.socket.destroy(); });
  a.socket.write('{"type":"guild_create","name":"Hoenn Heroes","tag":"HH"}\n');
  await a.next(m => m.type === 'guild_info');
  b.socket.write('{"type":"guild_join","name":"Hoenn Heroes"}\n');
  await b.next(m => m.type === 'guild_info');
  a.socket.write('{"type":"guild_disband"}\n');
  const disbanded = await a.next(m => m.type === 'guild_disbanded');
  assert.ok(disbanded);
  a.socket.write('{"type":"guild_info"}\n');
  const info = await a.next(m => m.type === 'guild_info');
  assert.equal(info.guild, null);
});

test('guild_kick removes a member by fingerprint', async t => {
  const identityStore = new MemoryIdentityStore();
  const guildStore = new MemoryGuildStore(fp => identityStore.findByFingerprint(fp));
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, guildStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port;
  const a = await enrollAndConnect(port, identityStore, 'May');
  const b = await enrollAndConnect(port, identityStore, 'Brendan');
  t.after(() => { a.socket.destroy(); b.socket.destroy(); });
  a.socket.write('{"type":"guild_create","name":"Hoenn Heroes","tag":"HH"}\n');
  await a.next(m => m.type === 'guild_info');
  b.socket.write('{"type":"guild_join","name":"Hoenn Heroes"}\n');
  await b.next(m => m.type === 'guild_info');
  a.socket.write(JSON.stringify({ type: 'guild_kick', fingerprint: b.enrollment.fingerprint }) + '\n');
  const ok = await a.next(m => m.type === 'guild_kick_ok');
  assert.equal(ok.fingerprint, b.enrollment.fingerprint);
  const kicked = await b.next(m => m.type === 'guild_kicked');
  assert.ok(kicked);
});
