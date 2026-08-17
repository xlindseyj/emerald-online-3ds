import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresIdentityStore } from '../src/identity-store.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL identity lifecycle persists only credential verifiers', { skip: !databaseUrl }, async t => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresIdentityStore(pool, 'test-only-pepper-with-at-least-thirty-two-bytes');
  const enrollment = await store.enroll({ withRecovery: true });
  assert.ok(await store.authenticate(enrollment.identityId, enrollment.token));

  const rawCredential = await pool.query('SELECT token_hash FROM device_credentials WHERE identity_id=$1', [enrollment.identityId]);
  assert.equal(rawCredential.rows[0].token_hash.length, 32);
  assert.equal(rawCredential.rows[0].token_hash.toString('hex').includes(enrollment.token), false);
  const rawRecovery = await pool.query('SELECT verifier FROM identity_recovery WHERE identity_id=$1', [enrollment.identityId]);
  assert.equal(rawRecovery.rows[0].verifier.toString('utf8').includes(enrollment.recoveryCode), false);

  const recovered = await store.recover(enrollment.identityId, enrollment.recoveryCode);
  assert.equal(await store.authenticate(enrollment.identityId, enrollment.token), null);
  assert.ok(await store.authenticate(recovered.identityId, recovered.token));
  assert.equal(await store.revoke(recovered.identityId, recovered.credentialId), true);
  assert.equal(await store.authenticate(recovered.identityId, recovered.token), null);
  assert.equal(await store.deleteIdentity(enrollment.identityId), true);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM device_credentials WHERE identity_id=$1', [enrollment.identityId])).rows[0].count, 0);
});

test('PostgreSQL admin sessions inherit moderator authorization', { skip: !databaseUrl }, async t => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresIdentityStore(pool, 'test-only-pepper-with-at-least-thirty-two-bytes');
  const enrollment = await store.enroll();
  t.after(() => store.deleteIdentity(enrollment.identityId));
  await pool.query("INSERT INTO identity_roles(identity_id, role) VALUES($1, 'admin')", [enrollment.identityId]);
  const pairing = await store.startPairing();
  await store.approvePairing(enrollment.identityId, enrollment.credentialId, pairing.code);
  const browser = await store.consumePairing(pairing.code, pairing.requestToken);
  const session = await store.authenticateBrowserSession(browser.token);
  assert.equal(session.is_admin, true);
  assert.equal(session.is_moderator, true);
});
