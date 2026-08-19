import crypto from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/i;
const RECOVERY = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){4}$/;
const PAIRING = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const FINGERPRINT = /^[A-F0-9]{10}$/;
const ROLES = new Set(['moderator', 'admin']);
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function credentialHash(pepper, token) {
  return crypto.createHmac('sha256', pepper).update(token.toLowerCase()).digest();
}

function purposeHash(pepper, purpose, value) {
  return crypto.createHmac('sha256', pepper).update(`${purpose}:${value}`).digest();
}

function randomReadableCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < bytes.length; i++) code += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
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
      return { identityId, credentialId, token, fingerprint: displayFingerprint, recoveryCode: code, is_admin: false, is_moderator: false };
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
       RETURNING c.id AS credential_id, i.id AS identity_id, i.fingerprint,
         EXISTS (SELECT 1 FROM identity_roles r WHERE r.identity_id=i.id AND r.role='admin') AS is_admin,
         EXISTS (SELECT 1 FROM identity_roles r WHERE r.identity_id=i.id AND r.role IN ('moderator', 'admin')) AS is_moderator`,
      [identityId, hash]
    );
    return result.rows[0] ?? null;
  }

  async count() {
    const result = await this.pool.query("SELECT count(*)::int AS count FROM identities WHERE deleted_at IS NULL");
    return result.rows[0].count;
  }

  async recover(identityId, code) {
    if (!UUID.test(identityId ?? '') || !RECOVERY.test(code ?? '')) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT r.salt, r.verifier, i.fingerprint,
           EXISTS (SELECT 1 FROM identity_roles r2 WHERE r2.identity_id=i.id AND r2.role='admin') AS is_admin,
           EXISTS (SELECT 1 FROM identity_roles r2 WHERE r2.identity_id=i.id AND r2.role IN ('moderator', 'admin')) AS is_moderator
         FROM identity_recovery r
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
      return {
        identityId, credentialId, token, fingerprint: result.rows[0].fingerprint,
        is_admin: result.rows[0].is_admin === true,
        is_moderator: result.rows[0].is_moderator === true
      };
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

  async startPairing() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomReadableCode();
      const requestToken = crypto.randomBytes(32).toString('hex');
      try {
        const result = await this.pool.query(
          `INSERT INTO pairing_codes (id, code_hash, request_hash, expires_at)
           VALUES ($1, $2, $3, now() + interval '5 minutes') RETURNING expires_at`,
          [crypto.randomUUID(), purposeHash(this.pepper, 'pairing-code', code), purposeHash(this.pepper, 'pairing-request', requestToken)]
        );
        return { code, requestToken, expiresAt: result.rows[0].expires_at };
      } catch (error) {
        if (error.code !== '23505' || attempt === 4) throw error;
      }
    }
    throw new Error('unable to allocate pairing code');
  }

  async approvePairing(identityId, credentialId, code) {
    if (!UUID.test(identityId ?? '') || !UUID.test(credentialId ?? '') || !PAIRING.test(code ?? '')) return null;
    const result = await this.pool.query(
      `UPDATE pairing_codes p SET identity_id=$1, approved_by_credential_id=$2, approved_at=now()
       WHERE p.code_hash=$3 AND p.identity_id IS NULL AND p.approved_at IS NULL
       AND p.consumed_at IS NULL AND p.expires_at > now()
       AND EXISTS (SELECT 1 FROM device_credentials c WHERE c.id=$2 AND c.identity_id=$1 AND c.revoked_at IS NULL)
       RETURNING p.expires_at`,
      [identityId, credentialId, purposeHash(this.pepper, 'pairing-code', code)]
    );
    return result.rows[0] ?? null;
  }

  async consumePairing(code, requestToken) {
    if (!PAIRING.test(code ?? '') || !TOKEN.test(requestToken ?? '')) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pairing = await client.query(
        `SELECT p.id, p.identity_id, i.fingerprint
         FROM pairing_codes p JOIN identities i ON i.id=p.identity_id
         WHERE p.code_hash=$1 AND p.request_hash=$2 AND p.approved_at IS NOT NULL
         AND p.consumed_at IS NULL AND p.expires_at > now() AND i.deleted_at IS NULL FOR UPDATE`,
        [purposeHash(this.pepper, 'pairing-code', code), purposeHash(this.pepper, 'pairing-request', requestToken)]
      );
      if (!pairing.rowCount) { await client.query('ROLLBACK'); return null; }
      const token = crypto.randomBytes(32).toString('hex');
      const sessionId = crypto.randomUUID();
      await client.query(
        `INSERT INTO browser_sessions (id, identity_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 days')`,
        [sessionId, pairing.rows[0].identity_id, purposeHash(this.pepper, 'browser-session', token)]
      );
      await client.query('UPDATE pairing_codes SET consumed_at=now() WHERE id=$1', [pairing.rows[0].id]);
      await client.query('COMMIT');
      return { token, sessionId, identityId: pairing.rows[0].identity_id, fingerprint: pairing.rows[0].fingerprint, csrfToken: this.browserCsrf(token) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  browserCsrf(token) {
    if (!TOKEN.test(token ?? '')) return null;
    return purposeHash(this.pepper, 'browser-csrf', token).toString('hex');
  }

  async authenticateBrowserSession(token) {
    if (!TOKEN.test(token ?? '')) return null;
    const result = await this.pool.query(
      `UPDATE browser_sessions b SET last_used_at=now(), expires_at=now() + interval '30 days'
       FROM identities i WHERE b.token_hash=$1 AND b.identity_id=i.id AND b.revoked_at IS NULL
       AND b.expires_at > now() AND b.last_used_at > now() - interval '30 days' AND i.deleted_at IS NULL
       RETURNING b.id AS session_id, i.id AS identity_id, i.fingerprint,
         EXISTS (SELECT 1 FROM identity_roles r WHERE r.identity_id=i.id AND r.role='admin') AS is_admin,
         EXISTS (SELECT 1 FROM identity_roles r WHERE r.identity_id=i.id AND r.role IN ('moderator', 'admin')) AS is_moderator`,
      [purposeHash(this.pepper, 'browser-session', token)]
    );
    const session = result.rows[0];
    return session ? { ...session, csrf_token: this.browserCsrf(token) } : null;
  }

  async revokeBrowserSession(token) {
    if (!TOKEN.test(token ?? '')) return false;
    const result = await this.pool.query(
      'UPDATE browser_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING id',
      [purposeHash(this.pepper, 'browser-session', token)]
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

  async assignRole(actorFingerprint, targetFingerprint, role) {
    if (!FINGERPRINT.test(actorFingerprint ?? '') || !FINGERPRINT.test(targetFingerprint ?? '') || !ROLES.has(role ?? '')) return false;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const actor = await client.query(
        "SELECT i.id, EXISTS (SELECT 1 FROM identity_roles r WHERE r.identity_id=i.id AND r.role='admin') AS is_admin FROM identities i WHERE i.fingerprint=$1 AND i.deleted_at IS NULL",
        [actorFingerprint]
      );
      if (!actor.rowCount || !actor.rows[0].is_admin) { await client.query('ROLLBACK'); return false; }
      const target = await client.query('SELECT id FROM identities WHERE fingerprint=$1 AND deleted_at IS NULL', [targetFingerprint]);
      if (!target.rowCount) { await client.query('ROLLBACK'); return false; }
      const targetIdentityId = target.rows[0].id;
      await client.query('INSERT INTO identity_roles (identity_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING', [targetIdentityId, role]);
      await client.query(
        "INSERT INTO moderation_audit (actor_identity_id, target_identity_id, action, details) VALUES ($1, $2, 'role_assigned', $3)",
        [actor.rows[0].id, targetIdentityId, JSON.stringify({ role })]
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async findByFingerprint(fingerprint) {
    if (!FINGERPRINT.test(fingerprint ?? '')) return null;
    const result = await this.pool.query(
      `SELECT i.id, i.fingerprint,
         EXISTS (SELECT 1 FROM identity_roles r WHERE r.identity_id=i.id AND r.role='admin') AS is_admin,
         EXISTS (SELECT 1 FROM identity_roles r WHERE r.identity_id=i.id AND r.role IN ('moderator','admin')) AS is_moderator
       FROM identities i WHERE i.fingerprint=$1 AND i.deleted_at IS NULL`,
      [fingerprint]
    );
    return result.rows[0] ?? null;
  }

  async revokeRole(actorFingerprint, targetFingerprint, role) {
    if (!FINGERPRINT.test(actorFingerprint ?? '') || !FINGERPRINT.test(targetFingerprint ?? '') || !ROLES.has(role ?? '')) return false;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const actor = await client.query(
        "SELECT i.id, EXISTS (SELECT 1 FROM identity_roles r WHERE r.identity_id=i.id AND r.role='admin') AS is_admin FROM identities i WHERE i.fingerprint=$1 AND i.deleted_at IS NULL",
        [actorFingerprint]
      );
      if (!actor.rowCount || !actor.rows[0].is_admin) { await client.query('ROLLBACK'); return false; }
      const target = await client.query('SELECT id FROM identities WHERE fingerprint=$1 AND deleted_at IS NULL', [targetFingerprint]);
      if (!target.rowCount) { await client.query('ROLLBACK'); return false; }
      const targetIdentityId = target.rows[0].id;
      await client.query('DELETE FROM identity_roles WHERE identity_id=$1 AND role=$2', [targetIdentityId, role]);
      await client.query(
        "INSERT INTO moderation_audit (actor_identity_id, target_identity_id, action, details) VALUES ($1, $2, 'role_revoked', $3)",
        [actor.rows[0].id, targetIdentityId, JSON.stringify({ role })]
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

export class MemoryIdentityStore {
  constructor() { this.pepper = crypto.randomBytes(32); this.identities = new Map(); this.pairings = new Map(); this.browserSessions = new Map(); this.audit = []; }
  async enroll({ withRecovery = false } = {}) {
    const identityId = crypto.randomUUID(), credentialId = crypto.randomUUID(), token = crypto.randomBytes(32).toString('hex');
    const code = withRecovery ? recoveryCode() : null, salt = code ? crypto.randomBytes(16) : null;
    const record = { identityId, fingerprint: fingerprint(identityId), credentials: new Map([[credentialId, credentialHash(this.pepper, token)]]), recoverySalt: salt, recoveryVerifier: code ? await scrypt(code, salt) : null, isAdmin: false, isModerator: false };
    this.identities.set(identityId, record);
    return { identityId, credentialId, token, fingerprint: record.fingerprint, recoveryCode: code, is_admin: false, is_moderator: false };
  }
  async authenticate(identityId, token) {
    const record = this.identities.get(identityId); if (!record || !TOKEN.test(token ?? '')) return null;
    const hash = credentialHash(this.pepper, token);
    for (const [credentialId, stored] of record.credentials) if (crypto.timingSafeEqual(hash, stored)) return { identity_id: identityId, credential_id: credentialId, fingerprint: record.fingerprint, is_admin: record.isAdmin === true, is_moderator: record.isModerator === true };
    return null;
  }
  async recover(identityId, code) {
    const record = this.identities.get(identityId); if (!record?.recoveryVerifier || !RECOVERY.test(code ?? '')) return null;
    const candidate = await scrypt(code, record.recoverySalt); if (!crypto.timingSafeEqual(candidate, record.recoveryVerifier)) return null;
    const credentialId = crypto.randomUUID(), token = crypto.randomBytes(32).toString('hex'); record.credentials.clear(); record.credentials.set(credentialId, credentialHash(this.pepper, token)); record.recoveryVerifier = null;
    return { identityId, credentialId, token, fingerprint: record.fingerprint, is_admin: record.isAdmin === true, is_moderator: record.isModerator === true };
  }
  async revoke(identityId, credentialId) { return this.identities.get(identityId)?.credentials.delete(credentialId) ?? false; }
  async startPairing() {
    const code = randomReadableCode(), requestToken = crypto.randomBytes(32).toString('hex');
    this.pairings.set(code, { requestHash: purposeHash(this.pepper, 'pairing-request', requestToken), expiresAt: new Date(Date.now() + 300000), identityId: null, credentialId: null, consumed: false });
    return { code, requestToken, expiresAt: this.pairings.get(code).expiresAt };
  }
  async approvePairing(identityId, credentialId, code) {
    const pairing = this.pairings.get(code), identity = this.identities.get(identityId);
    if (!pairing || pairing.expiresAt <= new Date() || pairing.consumed || pairing.identityId || !identity?.credentials.has(credentialId)) return null;
    pairing.identityId = identityId; pairing.credentialId = credentialId;
    return { expires_at: pairing.expiresAt };
  }
  async consumePairing(code, requestToken) {
    const pairing = this.pairings.get(code);
    if (!pairing?.identityId || pairing.consumed || pairing.expiresAt <= new Date()) return null;
    const requestHash = purposeHash(this.pepper, 'pairing-request', requestToken ?? '');
    if (!crypto.timingSafeEqual(pairing.requestHash, requestHash)) return null;
    pairing.consumed = true;
    const token = crypto.randomBytes(32).toString('hex'), sessionId = crypto.randomUUID();
    this.browserSessions.set(token, { sessionId, identityId: pairing.identityId, expiresAt: Date.now() + 2592000000, revoked: false });
    return { token, sessionId, identityId: pairing.identityId, fingerprint: this.identities.get(pairing.identityId).fingerprint, csrfToken: this.browserCsrf(token) };
  }
  browserCsrf(token) { return TOKEN.test(token ?? '') ? purposeHash(this.pepper, 'browser-csrf', token).toString('hex') : null; }
  async authenticateBrowserSession(token) {
    const session = this.browserSessions.get(token);
    if (!session || session.revoked || session.expiresAt <= Date.now() || !this.identities.has(session.identityId)) return null;
    session.expiresAt = Date.now() + 2592000000;
    const identity = this.identities.get(session.identityId);
    const isAdmin = identity.isAdmin === true;
    return { session_id: session.sessionId, identity_id: session.identityId, fingerprint: identity.fingerprint, is_admin: isAdmin, is_moderator: isAdmin || identity.isModerator === true, csrf_token: this.browserCsrf(token) };
  }
  async revokeBrowserSession(token) { const session = this.browserSessions.get(token); if (!session || session.revoked) return false; session.revoked = true; return true; }
  async count() { return this.identities.size; }
  async exportIdentity(identityId) { const r = this.identities.get(identityId); return r ? { id: r.identityId, fingerprint: r.fingerprint, active_device_credentials: r.credentials.size } : null; }
  async deleteIdentity(identityId) { return this.identities.delete(identityId); }
  async assignRole(actorFingerprint, targetFingerprint, role) {
    if (!FINGERPRINT.test(actorFingerprint ?? '') || !FINGERPRINT.test(targetFingerprint ?? '') || !ROLES.has(role ?? '')) return false;
    const actor = [...this.identities.values()].find(r => r.fingerprint === actorFingerprint); if (!actor || actor.isAdmin !== true) return false;
    const target = [...this.identities.values()].find(r => r.fingerprint === targetFingerprint); if (!target) return false;
    if (role === 'admin') target.isAdmin = true; else target.isModerator = true;
    this.audit.push({ action: 'role_assigned', actor_identity_id: actor.identityId, target_identity_id: target.identityId, role, created_at: Date.now() });
    return true;
  }
  async findByFingerprint(fingerprint) {
    if (!FINGERPRINT.test(fingerprint ?? '')) return null;
    const r = [...this.identities.values()].find(r => r.fingerprint === fingerprint);
    if (!r) return null;
    return { id: r.identityId, fingerprint: r.fingerprint, is_admin: r.isAdmin === true, is_moderator: r.isModerator === true };
  }

  async revokeRole(actorFingerprint, targetFingerprint, role) {
    if (!FINGERPRINT.test(actorFingerprint ?? '') || !FINGERPRINT.test(targetFingerprint ?? '') || !ROLES.has(role ?? '')) return false;
    const actor = [...this.identities.values()].find(r => r.fingerprint === actorFingerprint); if (!actor || actor.isAdmin !== true) return false;
    const target = [...this.identities.values()].find(r => r.fingerprint === targetFingerprint); if (!target) return false;
    if (role === 'admin') target.isAdmin = false; else target.isModerator = false;
    this.audit.push({ action: 'role_revoked', actor_identity_id: actor.identityId, target_identity_id: target.identityId, role, created_at: Date.now() });
    return true;
  }
}
