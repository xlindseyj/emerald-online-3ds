import crypto from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/i;
const RECOVERY = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){4}$/;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function credentialHash(pepper, token) {
  return crypto.createHmac('sha256', pepper).update(token.toLowerCase()).digest();
}

function fingerprint(identityId) {
  return crypto.createHash('sha256').update(`emerald-fingerprint:${identityId}`).digest('hex').slice(0, 10).toUpperCase();
}

function recoveryCode() {
  const bytes = crypto.randomBytes(20);
  let code = '';
  for (let i = 0; i < bytes.length; i++) {
    if (i && i % 4 === 0) code += '-';
    code += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return code;
}

function scrypt(value, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(value, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}

export function validIdentityCredential(identityId, token) {
  return UUID.test(identityId ?? '') && TOKEN.test(token ?? '');
}

export class PostgresIdentityStore {
  constructor(pool, pepper) {
    if (!pool) throw new Error('PostgreSQL pool is required');
    if (typeof pepper !== 'string' || Buffer.byteLength(pepper) < 32) throw new Error('IDENTITY_PEPPER must contain at least 32 bytes');
    this.pool = pool;
    this.pepper = pepper;
  }

  async enroll({ withRecovery = false, ipHash = null } = {}) {
    const identityId = crypto.randomUUID();
    const credentialId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const displayFingerprint = fingerprint(identityId);
    const code = withRecovery ? recoveryCode() : null;
    const salt = code ? crypto.randomBytes(16) : null;
    const verifier = code ? await scrypt(code, salt) : null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO identities (id, fingerprint) VALUES ($1, $2)', [identityId, displayFingerprint]);
      await client.query('INSERT INTO identity_preferences (identity_id) VALUES ($1)', [identityId]);
      await client.query('INSERT INTO device_credentials (id, identity_id, token_hash) VALUES ($1, $2, $3)', [credentialId, identityId, credentialHash(this.pepper, token)]);
      if (code) await client.query('INSERT INTO identity_recovery (identity_id, salt, verifier) VALUES ($1, $2, $3)', [identityId, salt, verifier]);
      await client.query("INSERT INTO security_events (identity_id, event_type, ip_hash, expires_at) VALUES ($1, 'identity_enrolled', $2, now() + interval '7 days')", [identityId, ipHash]);
      await client.query('COMMIT');
      return { identityId, credentialId, token, fingerprint: displayFingerprint, recoveryCode: code };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async authenticate(identityId, token) {
    if (!validIdentityCredential(identityId, token)) return null;
    const hash = credentialHash(this.pepper, token);
    const result = await this.pool.query(
      `UPDATE device_credentials c SET last_used_at = now()
       FROM identities i WHERE c.identity_id = $1 AND c.token_hash = $2
       AND c.revoked_at IS NULL AND i.id = c.identity_id AND i.deleted_at IS NULL
       RETURNING c.id AS credential_id, i.id AS identity_id, i.fingerprint`,
      [identityId, hash]
    );
    return result.rows[0] ?? null;
  }

  async recover(identityId, code) {
    if (!UUID.test(identityId ?? '') || !RECOVERY.test(code ?? '')) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT r.salt, r.verifier, i.fingerprint FROM identity_recovery r
         JOIN identities i ON i.id = r.identity_id
         WHERE r.identity_id = $1 AND r.used_at IS NULL AND i.deleted_at IS NULL FOR UPDATE`,
        [identityId]
      );
      if (!result.rowCount) { await client.query('ROLLBACK'); return null; }
      const candidate = await scrypt(code, result.rows[0].salt);
      if (!crypto.timingSafeEqual(candidate, result.rows[0].verifier)) { await client.query('ROLLBACK'); return null; }
      const token = crypto.randomBytes(32).toString('hex');
      const credentialId = crypto.randomUUID();
      await client.query('UPDATE device_credentials SET revoked_at = now() WHERE identity_id = $1 AND revoked_at IS NULL', [identityId]);
      await client.query('UPDATE browser_sessions SET revoked_at = now() WHERE identity_id = $1 AND revoked_at IS NULL', [identityId]);
      await client.query('UPDATE identity_recovery SET used_at = now() WHERE identity_id = $1', [identityId]);
      await client.query('INSERT INTO device_credentials (id, identity_id, token_hash) VALUES ($1, $2, $3)', [credentialId, identityId, credentialHash(this.pepper, token)]);
      await client.query("INSERT INTO security_events (identity_id, event_type, expires_at) VALUES ($1, 'identity_recovered', now() + interval '7 days')", [identityId]);
      await client.query('COMMIT');
      return { identityId, credentialId, token, fingerprint: result.rows[0].fingerprint };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async revoke(identityId, credentialId) {
    const result = await this.pool.query(
      'UPDATE device_credentials SET revoked_at = now() WHERE id = $1 AND identity_id = $2 AND revoked_at IS NULL RETURNING id',
      [credentialId, identityId]
    );
    return result.rowCount === 1;
  }

  async exportIdentity(identityId) {
    const result = await this.pool.query(
      `SELECT i.id, i.fingerprint, i.created_at, p.leaderboard_enabled, p.stat_fields, p.preferences,
        (SELECT count(*)::int FROM device_credentials c WHERE c.identity_id=i.id AND c.revoked_at IS NULL) AS active_device_credentials,
        (SELECT count(*)::int FROM browser_sessions b WHERE b.identity_id=i.id AND b.revoked_at IS NULL AND b.expires_at > now()) AS active_browser_sessions
       FROM identities i JOIN identity_preferences p ON p.identity_id=i.id WHERE i.id=$1 AND i.deleted_at IS NULL`,
      [identityId]
    );
    return result.rows[0] ?? null;
  }

  async deleteIdentity(identityId) {
    const result = await this.pool.query('DELETE FROM identities WHERE id = $1 RETURNING id', [identityId]);
    return result.rowCount === 1;
  }
}

export class MemoryIdentityStore {
  constructor() { this.pepper = crypto.randomBytes(32); this.identities = new Map(); }
  async enroll({ withRecovery = false } = {}) {
    const identityId = crypto.randomUUID(), credentialId = crypto.randomUUID(), token = crypto.randomBytes(32).toString('hex');
    const code = withRecovery ? recoveryCode() : null, salt = code ? crypto.randomBytes(16) : null;
    const record = { identityId, fingerprint: fingerprint(identityId), credentials: new Map([[credentialId, credentialHash(this.pepper, token)]]), recoverySalt: salt, recoveryVerifier: code ? await scrypt(code, salt) : null };
    this.identities.set(identityId, record);
    return { identityId, credentialId, token, fingerprint: record.fingerprint, recoveryCode: code };
  }
  async authenticate(identityId, token) {
    const record = this.identities.get(identityId); if (!record || !TOKEN.test(token ?? '')) return null;
    const hash = credentialHash(this.pepper, token);
    for (const [credentialId, stored] of record.credentials) if (crypto.timingSafeEqual(hash, stored)) return { identity_id: identityId, credential_id: credentialId, fingerprint: record.fingerprint };
    return null;
  }
  async recover(identityId, code) {
    const record = this.identities.get(identityId); if (!record?.recoveryVerifier || !RECOVERY.test(code ?? '')) return null;
    const candidate = await scrypt(code, record.recoverySalt); if (!crypto.timingSafeEqual(candidate, record.recoveryVerifier)) return null;
    const credentialId = crypto.randomUUID(), token = crypto.randomBytes(32).toString('hex'); record.credentials.clear(); record.credentials.set(credentialId, credentialHash(this.pepper, token)); record.recoveryVerifier = null;
    return { identityId, credentialId, token, fingerprint: record.fingerprint };
  }
  async revoke(identityId, credentialId) { return this.identities.get(identityId)?.credentials.delete(credentialId) ?? false; }
  async exportIdentity(identityId) { const r = this.identities.get(identityId); return r ? { id: r.identityId, fingerprint: r.fingerprint, active_device_credentials: r.credentials.size } : null; }
  async deleteIdentity(identityId) { return this.identities.delete(identityId); }
}
