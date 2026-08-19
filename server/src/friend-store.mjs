function canonicalPair(a, b) {
  return a.localeCompare(b) < 0 ? `${a}:${b}` : `${b}:${a}`;
}

export class PostgresFriendStore {
  constructor(pool, resolveFingerprint) {
    if (!pool) throw new Error('PostgreSQL pool is required');
    if (typeof resolveFingerprint !== 'function') throw new Error('resolveFingerprint is required');
    this.pool = pool;
    this.resolveFingerprint = resolveFingerprint;
  }

  async _resolve(fingerprint) {
    const result = await this.resolveFingerprint(fingerprint);
    return result?.identity_id ?? result?.id ?? null;
  }

  async requestFriend(identityId, targetFingerprint) {
    const targetId = await this._resolve(targetFingerprint);
    if (!targetId) return { error: 'identity_not_found' };
    if (targetId === identityId) return { error: 'cannot_friend_self' };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Check for an existing relationship in either direction.
      const existing = await client.query(
        `SELECT requester_id, addressee_id, status
         FROM friendships
         WHERE (requester_id = $1 AND addressee_id = $2)
            OR (requester_id = $2 AND addressee_id = $1)
         FOR UPDATE`,
        [identityId, targetId]
      );
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (row.status === 'accepted') { await client.query('COMMIT'); return { status: 'accepted' }; }
        // If the other person already sent a pending request, auto-accept.
        if (row.requester_id === targetId && row.addressee_id === identityId) {
          await client.query(
            `UPDATE friendships
             SET status = 'accepted', updated_at = now()
             WHERE requester_id = $1 AND addressee_id = $2`,
            [targetId, identityId]
          );
          await client.query('COMMIT');
          return { status: 'accepted' };
        }
        await client.query('COMMIT');
        return { error: 'friend_request_pending' };
      }
      await client.query(
        `INSERT INTO friendships (requester_id, addressee_id, status)
         VALUES ($1, $2, 'pending')`,
        [identityId, targetId]
      );
      await client.query('COMMIT');
      return { status: 'pending' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async acceptFriend(identityId, targetFingerprint) {
    const targetId = await this._resolve(targetFingerprint);
    if (!targetId) return { error: 'identity_not_found' };
    const result = await this.pool.query(
      `UPDATE friendships
       SET status = 'accepted', updated_at = now()
       WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'
       RETURNING requester_id, addressee_id`,
      [targetId, identityId]
    );
    if (!result.rowCount) return { error: 'friend_request_not_found' };
    return { status: 'accepted' };
  }

  async removeFriend(identityId, targetFingerprint) {
    const targetId = await this._resolve(targetFingerprint);
    if (!targetId) return { error: 'identity_not_found' };
    await this.pool.query(
      `DELETE FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [identityId, targetId]
    );
    return { removed: true };
  }

  async listFriends(identityId) {
    const result = await this.pool.query(
      `SELECT
         CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id,
         status,
         requester_id = $1 AS is_requester,
         created_at
       FROM friendships
       WHERE requester_id = $1 OR addressee_id = $1
       ORDER BY created_at ASC`,
      [identityId]
    );
    return result.rows.map(row => ({
      identity_id: row.friend_id,
      status: row.status,
      is_requester: row.is_requester,
      created_at: row.created_at
    }));
  }
}

export class MemoryFriendStore {
  constructor(resolveFingerprint) {
    if (typeof resolveFingerprint !== 'function') throw new Error('resolveFingerprint is required');
    this.resolveFingerprint = resolveFingerprint;
    this.friendships = new Map(); // key: canonical pair -> { requester_id, addressee_id, status, created_at }
  }

  async _resolve(fingerprint) {
    const result = await this.resolveFingerprint(fingerprint);
    return result?.identity_id ?? result?.id ?? null;
  }

  _key(a, b) { return canonicalPair(a, b); }

  async requestFriend(identityId, targetFingerprint) {
    const targetId = await this._resolve(targetFingerprint);
    if (!targetId) return { error: 'identity_not_found' };
    if (targetId === identityId) return { error: 'cannot_friend_self' };
    const key = this._key(identityId, targetId);
    const existing = this.friendships.get(key);
    if (existing) {
      if (existing.status === 'accepted') return { status: 'accepted' };
      if (existing.requester_id === targetId && existing.addressee_id === identityId) {
        existing.status = 'accepted';
        existing.updated_at = Date.now();
        return { status: 'accepted' };
      }
      return { error: 'friend_request_pending' };
    }
    this.friendships.set(key, {
      requester_id: identityId,
      addressee_id: targetId,
      status: 'pending',
      created_at: Date.now(),
      updated_at: Date.now()
    });
    return { status: 'pending' };
  }

  async acceptFriend(identityId, targetFingerprint) {
    const targetId = await this._resolve(targetFingerprint);
    if (!targetId) return { error: 'identity_not_found' };
    const key = this._key(identityId, targetId);
    const existing = this.friendships.get(key);
    if (!existing || existing.status !== 'pending' || existing.requester_id !== targetId || existing.addressee_id !== identityId) {
      return { error: 'friend_request_not_found' };
    }
    existing.status = 'accepted';
    existing.updated_at = Date.now();
    return { status: 'accepted' };
  }

  async removeFriend(identityId, targetFingerprint) {
    const targetId = await this._resolve(targetFingerprint);
    if (!targetId) return { error: 'identity_not_found' };
    const key = this._key(identityId, targetId);
    this.friendships.delete(key);
    return { removed: true };
  }

  async listFriends(identityId) {
    return [...this.friendships.values()]
      .filter(fs => fs.requester_id === identityId || fs.addressee_id === identityId)
      .map(fs => ({
        identity_id: fs.requester_id === identityId ? fs.addressee_id : fs.requester_id,
        status: fs.status,
        is_requester: fs.requester_id === identityId,
        created_at: new Date(fs.created_at).toISOString()
      }));
  }
}
