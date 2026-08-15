import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { MemoryIdentityStore } from '../src/identity-store.mjs';
import { createPresenceServer } from '../src/server.mjs';

test('identity enrollment, recovery, revocation, export, and deletion', async () => {
  const store = new MemoryIdentityStore();
  const enrollment = await store.enroll({ withRecovery: true });
  assert.match(enrollment.identityId, /^[0-9a-f-]{36}$/);
  assert.match(enrollment.token, /^[0-9a-f]{64}$/);
  assert.match(enrollment.fingerprint, /^[0-9A-F]{10}$/);
  assert.match(enrollment.recoveryCode, /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){4}$/);

  const authenticated = await store.authenticate(enrollment.identityId, enrollment.token);
  assert.equal(authenticated.identity_id, enrollment.identityId);
  assert.equal(authenticated.credential_id, enrollment.credentialId);
  assert.equal(await store.authenticate(enrollment.identityId, '0'.repeat(64)), null);

  const recovered = await store.recover(enrollment.identityId, enrollment.recoveryCode);
  assert.equal(recovered.identityId, enrollment.identityId);
  assert.equal(await store.authenticate(enrollment.identityId, enrollment.token), null);
  assert.ok(await store.authenticate(recovered.identityId, recovered.token));
  assert.equal(await store.recover(enrollment.identityId, enrollment.recoveryCode), null);

  const exported = await store.exportIdentity(enrollment.identityId);
  assert.equal(exported.active_device_credentials, 1);
  assert.equal(await store.revoke(recovered.identityId, recovered.credentialId), true);
  assert.equal(await store.authenticate(recovered.identityId, recovered.token), null);
  assert.equal(await store.deleteIdentity(enrollment.identityId), true);
  assert.equal(await store.exportIdentity(enrollment.identityId), null);
});

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => resolve(socket));
    socket.once('error', reject);
  });
}

function nextMessage(socket) {
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
      await new Promise((resolve, reject) => { wake = resolve; setTimeout(() => reject(new Error('message timeout')), 1500); });
    }
  };
}

test('protocol v2 enrolls and reconnects with a server-issued credential', async t => {
  const identityStore = new MemoryIdentityStore();
  const presence = createPresenceServer({ identityStore });
  await new Promise(resolve => presence.server.listen(0, '127.0.0.1', resolve));
  t.after(() => presence.server.close());

  const first = await connect(presence.server.address().port);
  t.after(() => first.destroy());
  const firstMessage = nextMessage(first);
  first.write(`${JSON.stringify({ type: 'enroll', version: 2, name: 'May', avatar: 'girl', recovery: true })}\n`);
  const enrolled = await firstMessage(message => message.type === 'enrolled');
  assert.match(enrolled.token, /^[0-9a-f]{64}$/);
  first.destroy();

  const reconnect = await connect(presence.server.address().port);
  t.after(() => reconnect.destroy());
  const reconnectMessage = nextMessage(reconnect);
  reconnect.write(`${JSON.stringify({ type: 'hello', version: 2, name: 'May', avatar: 'girl', identity: enrolled.id, token: enrolled.token })}\n`);
  const welcome = await reconnectMessage(message => message.type === 'welcome');
  assert.equal(welcome.id, enrolled.id);
  assert.equal(welcome.fingerprint, enrolled.fingerprint);

  reconnect.write('{"type":"export_identity"}\n');
  const exported = await reconnectMessage(message => message.type === 'identity_export');
  assert.equal(exported.data.id, enrolled.id);
});

test('protocol v2 rejects an invalid identity token', async t => {
  const identityStore = new MemoryIdentityStore();
  const enrolled = await identityStore.enroll();
  const presence = createPresenceServer({ identityStore });
  await new Promise(resolve => presence.server.listen(0, '127.0.0.1', resolve));
  t.after(() => presence.server.close());
  const socket = await connect(presence.server.address().port);
  t.after(() => socket.destroy());
  const message = nextMessage(socket);
  socket.write(`${JSON.stringify({ type: 'hello', version: 2, name: 'May', identity: enrolled.identityId, token: '0'.repeat(64) })}\n`);
  assert.equal((await message(item => item.type === 'error')).code, 'authentication_failed');
});
