export class PostgresTitleStore {
  constructor(pool) {
    if (!pool) throw new Error('PostgreSQL pool is required');
    this.pool = pool;
  }

  async unlockTitle(identityId, title, client = null) {
    const db = client ?? this.pool;
    await db.query(
      `INSERT INTO player_titles (identity_id, title, unlocked_at)
       VALUES ($1, $2, now())
       ON CONFLICT (identity_id, title) DO NOTHING`,
      [identityId, title]
    );
    return true;
  }

  async revokeTitle(identityId, title) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM player_titles WHERE identity_id = $1 AND title = $2',
        [identityId, title]
      );
      const equipped = await client.query(
        'SELECT title FROM identity_titles WHERE identity_id = $1 FOR UPDATE',
        [identityId]
      );
      if (equipped.rowCount && equipped.rows[0].title === title) {
        // Fall back to the most recently unlocked remaining title, or clear.
        const remaining = await client.query(
          'SELECT title FROM player_titles WHERE identity_id = $1 ORDER BY unlocked_at DESC LIMIT 1',
          [identityId]
        );
        if (remaining.rowCount) {
          await client.query(
            `INSERT INTO identity_titles (identity_id, title, updated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (identity_id) DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
            [identityId, remaining.rows[0].title]
          );
        } else {
          await client.query('DELETE FROM identity_titles WHERE identity_id = $1', [identityId]);
        }
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listTitles(identityId) {
    const [titlesResult, equippedResult] = await Promise.all([
      this.pool.query(
        `SELECT title, unlocked_at
         FROM player_titles
         WHERE identity_id = $1
         ORDER BY unlocked_at ASC`,
        [identityId]
      ),
      this.pool.query(
        'SELECT title FROM identity_titles WHERE identity_id = $1',
        [identityId]
      )
    ]);
    const equipped = equippedResult.rows[0]?.title ?? null;
    return titlesResult.rows.map(row => ({
      title: row.title,
      unlocked_at: row.unlocked_at,
      equipped: row.title === equipped
    }));
  }

  async equipTitle(identityId, title, client = null) {
    const externalClient = client !== null;
    if (!externalClient) client = await this.pool.connect();
    try {
      if (!externalClient) await client.query('BEGIN');
      const owned = await client.query(
        'SELECT 1 FROM player_titles WHERE identity_id = $1 AND title = $2',
        [identityId, title]
      );
      if (!owned.rowCount) {
        if (!externalClient) await client.query('ROLLBACK');
        return { error: 'title_not_owned' };
      }
      await client.query(
        `INSERT INTO identity_titles (identity_id, title, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (identity_id) DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
        [identityId, title]
      );
      if (!externalClient) await client.query('COMMIT');
      return { equipped: title };
    } catch (error) {
      if (!externalClient) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (!externalClient) client.release();
    }
  }

  async getEquippedTitle(identityId) {
    const result = await this.pool.query(
      'SELECT title FROM identity_titles WHERE identity_id = $1',
      [identityId]
    );
    return result.rows[0]?.title ?? null;
  }
}

export class MemoryTitleStore {
  constructor() {
    this.inventory = new Map(); // key: identityId -> Set of titles
    this.equipped = new Map();  // key: identityId -> title
  }

  async unlockTitle(identityId, title) {
    if (!this.inventory.has(identityId)) this.inventory.set(identityId, new Set());
    this.inventory.get(identityId).add(title);
    if (!this.equipped.has(identityId)) this.equipped.set(identityId, title);
    return true;
  }

  async revokeTitle(identityId, title) {
    this.inventory.get(identityId)?.delete(title);
    if (this.equipped.get(identityId) === title) {
      const remaining = this.inventory.get(identityId)?.size
        ? [...this.inventory.get(identityId).values()][0]
        : null;
      if (remaining) this.equipped.set(identityId, remaining);
      else this.equipped.delete(identityId);
    }
    return true;
  }

  async listTitles(identityId) {
    const equipped = this.equipped.get(identityId) ?? null;
    const titles = this.inventory.get(identityId) ?? new Set();
    return [...titles].map(title => ({
      title,
      unlocked_at: new Date().toISOString(),
      equipped: title === equipped
    }));
  }

  async equipTitle(identityId, title) {
    if (!this.inventory.get(identityId)?.has(title)) return { error: 'title_not_owned' };
    this.equipped.set(identityId, title);
    return { equipped: title };
  }

  async getEquippedTitle(identityId) {
    return this.equipped.get(identityId) ?? null;
  }
}
