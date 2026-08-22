import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { MemoryIdentityStore } from '../src/identity-store.mjs';
import { createPresenceServer } from '../src/server.mjs';
import { validateLinkJoin, validateLinkPacket } from '../src/protocol.mjs';

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => resolve(socket));
    socket.once('error', reject);
  });
}

function messages(socket) {
  let buffer = '', queue = [], wake;
  socket.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      queue.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
    wake?.();
  });
  return async predicate => {
    for (;;) {
      const index = queue.findIndex(predicate);
      if (index >= 0) return queue.splice(index, 1)[0];
      await new Promise((resolve, reject) => {
        wake = resolve;
        setTimeout(() => reject(new Error('message timeout')), 1000);
      });
    }
  };
}

test('link spike validators allow only bounded rooms, gpSP protocol, targets, and hex packets', () => {
  assert.equal(validateLinkJoin({ type: 'link_spike_join', room: 'ABCD-2345', core: 'gpSP v1.0' }), true);
  assert.equal(validateLinkJoin({ type: 'link_spike_join', room: 'public', core: 'gpSP v1.0' }), false);
  assert.equal(validateLinkJoin({ type: 'link_spike_join', room: 'ABCD-2345', core: 'other' }), false);
  assert.equal(validateLinkPacket({ type: 'link_packet', to: 0xffff, data: '4d504b31' }), true);
  assert.equal(validateLinkPacket({ type: 'link_packet', to: 4, data: '4d504b31' }), false);
  assert.equal(validateLinkPacket({ type: 'link_packet', to: 1, data: 'not-hex' }), false);
  assert.equal(validateLinkPacket({ type: 'link_packet', to: 1, data: 'aa'.repeat(513) }), false);
});

test('authenticated two-player experimental room relays bounded packets and tears down with the host', async t => {
  const identities = new MemoryIdentityStore();
  const hostIdentity = await identities.enroll(), guestIdentity = await identities.enroll();
  const presence = createPresenceServer({ identityStore: identities });
  await new Promise(resolve => presence.server.listen(0, '127.0.0.1', resolve));
  t.after(() => presence.server.close());
  const host = await connect(presence.server.address().port), guest = await connect(presence.server.address().port);
  t.after(() => { host.destroy(); guest.destroy(); });
  const nextHost = messages(host), nextGuest = messages(guest);
  host.write(`${JSON.stringify({ type: 'hello', version: 2, name: 'May', identity: hostIdentity.identityId, token: hostIdentity.token })}\n`);
  guest.write(`${JSON.stringify({ type: 'hello', version: 2, name: 'Brendan', identity: guestIdentity.identityId, token: guestIdentity.token })}\n`);
  await nextHost(message => message.type === 'welcome');
  await nextGuest(message => message.type === 'welcome');
  const join = { type: 'link_spike_join', room: 'TEST-2345', core: 'gpSP v1.0' };
  host.write(`${JSON.stringify(join)}\n`);
  assert.equal((await nextHost(message => message.type === 'link_waiting')).room, join.room);
  guest.write(`${JSON.stringify(join)}\n`);
  assert.deepEqual(await nextHost(message => message.type === 'link_started'), { type: 'link_started', room: join.room, clientId: 0, peerId: 1, core: join.core });
  assert.equal((await nextGuest(message => message.type === 'link_started')).clientId, 1);
  host.write(`${JSON.stringify({ type: 'link_packet', to: 0xffff, data: '4d504b3101020304' })}\n`);
  assert.deepEqual(await nextGuest(message => message.type === 'link_packet'), { type: 'link_packet', from: 0, data: '4d504b3101020304' });
  guest.write(`${JSON.stringify({ type: 'link_packet', to: 0, data: 'aabbccdd' })}\n`);
  assert.equal((await nextHost(message => message.type === 'link_packet')).from, 1);
  guest.write('{"type":"link_packet","to":0,"data":"private save data"}\n');
  assert.equal((await nextGuest(message => message.code === 'invalid_link_packet')).type, 'error');
  assert.equal(presence.status().linkRooms, 1);
  assert.equal(presence.status().linkPlayers, 2);
  assert.equal(presence.metrics.linkPackets, 2);
  host.destroy();
  assert.equal((await nextGuest(message => message.type === 'link_ended')).reason, 'host_left');
  assert.equal(presence.status().linkRooms, 0);
});

test('legacy clients cannot enter experimental link rooms', async t => {
  const presence = createPresenceServer();
  await new Promise(resolve => presence.server.listen(0, '127.0.0.1', resolve));
  t.after(() => presence.server.close());
  const socket = await connect(presence.server.address().port); t.after(() => socket.destroy());
  const next = messages(socket);
  socket.write('{"type":"hello","version":1,"name":"Legacy"}\n');
  await next(message => message.type === 'welcome');
  socket.write('{"type":"link_spike_join","room":"TEST-2345","core":"gpSP v1.0"}\n');
  assert.equal((await next(message => message.code === 'identity_required')).type, 'error');
});
