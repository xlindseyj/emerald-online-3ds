import assert from 'node:assert/strict';
import test from 'node:test';
import { createPresenceServer } from '../src/server.mjs';
import { runLoadTest } from '../../tools/load-test.mjs';

test('bounded load harness drives concurrent players without protocol errors', async t => {
  const presence = createPresenceServer({ host: '127.0.0.1', port: 0, maxConnections: 16, maxConnectionsPerIp: 16 });
  await new Promise(resolve => presence.server.listen(0, '127.0.0.1', resolve));
  t.after(() => presence.server.close());
  const result = await runLoadTest({ host: '127.0.0.1', port: presence.server.address().port, clients: 8, durationMs: 1000, rateHz: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.clients, 8);
  assert.equal(result.pongs, 8);
  assert.equal(result.protocolErrors.length, 0);
  assert.ok(result.statesSent >= 8);
  assert.ok(result.snapshotsReceived >= 8);
  assert.equal(presence.metrics.rejectedConnections, 0);
});

test('load harness refuses remote targets without an explicit opt-in', async () => {
  await assert.rejects(() => runLoadTest({ host: 'example.invalid', clients: 1, durationMs: 1000 }), /ALLOW_REMOTE_LOAD_TEST/);
});
