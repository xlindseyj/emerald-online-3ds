import crypto from 'node:crypto';

const MAX_GUILD_MEMBERS = 50;

export class PostgresGuildStore {
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

  async _getMembership(identityId, client = null) {
    const db = client ?? this.pool;
    const result = await db.query(
      `SELECT g.id, g.name, g.tag, g.leader_id, m.role
       FROM guild_members m
       JOIN guilds g ON g.id = m.guild_id
       WHERE m.identity_id = $1`,
      [identityId]
    );
    return result.rows[0] ?? null;
  }

  async createGuild(identityId, name, tag) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await this._getMembership(identityId, client);
      if (existing) { await client.query('ROLLBACK'); return { error: 'already_in_guild' }; }
      const nameCheck = await client.query('SELECT 1 FROM guilds WHERE LOWER(name) = LOWER($1)', [name]);
      if (nameCheck.rowCount) { await client.query('ROLLBACK'); return { error: 'guild_name_taken' }; }
      const tagCheck = await client.query('SELECT 1 FROM guilds WHERE LOWER(tag) = LOWER($1)', [tag]);
      if (tagCheck.rowCount) { await client.query('ROLLBACK'); return { error: 'guild_tag_taken' }; }
      const guildResult = await client.query(
        'INSERT INTO guilds (name, tag, leader_id) VALUES ($1, $2, $3) RETURNING id, name, tag, leader_id',
        [name, tag.toUpperCase(), identityId]
      );
      const guild = guildResult.rows[0];
      await client.query(
        'INSERT INTO guild_members (identity_id, guild_id, role) VALUES ($1, $2, $3)',
        [identityId, guild.id, 'leader']
      );
      await client.query('COMMIT');
      return { guild };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async joinGuild(identityId, name) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await this._getMembership(identityId, client);
      if (existing) { await client.query('ROLLBACK'); return { error: 'already_in_guild' }; }
      const guildResult = await client.query(
        'SELECT id, name, tag, leader_id FROM guilds WHERE LOWER(name) = LOWER($1)',
        [name]
      );
      if (!guildResult.rowCount) { await client.query('ROLLBACK'); return { error: 'guild_not_found' }; }
      const guild = guildResult.rows[0];
      const memberCountResult = await client.query(
        'SELECT count(*)::int AS count FROM guild_members WHERE guild_id = $1',
        [guild.id]
      );
      if (memberCountResult.rows[0].count >= MAX_GUILD_MEMBERS) { await client.query('ROLLBACK'); return { error: 'guild_full' }; }
      await client.query(
        'INSERT INTO guild_members (identity_id, guild_id, role) VALUES ($1, $2, $3)',
        [identityId, guild.id, 'member']
      );
      await client.query('COMMIT');
      return { guild };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async leaveGuild(identityId) {
    const membership = await this._getMembership(identityId);
    if (!membership) return { error: 'not_in_guild' };
    if (membership.role === 'leader') return { error: 'leader_must_disband' };
    await this.pool.query('DELETE FROM guild_members WHERE identity_id = $1', [identityId]);
    return { left: true, guild_id: membership.id };
  }

  async disbandGuild(identityId) {
    const membership = await this._getMembership(identityId);
    if (!membership) return { error: 'not_in_guild' };
    if (membership.role !== 'leader') return { error: 'not_leader' };
    await this.pool.query('DELETE FROM guilds WHERE id = $1', [membership.id]);
    return { disbanded: true, guild_id: membership.id };
  }

  async kickMember(leaderIdentityId, targetFingerprint) {
    const membership = await this._getMembership(leaderIdentityId);
    if (!membership) return { error: 'not_in_guild' };
    if (membership.role !== 'leader') return { error: 'not_leader' };
    const targetId = await this._resolve(targetFingerprint);
    if (!targetId) return { error: 'identity_not_found' };
    if (targetId === leaderIdentityId) return { error: 'cannot_kick_self' };
    const targetMembership = await this._getMembership(targetId);
    if (!targetMembership || targetMembership.id !== membership.id) return { error: 'not_in_same_guild' };
    await this.pool.query('DELETE FROM guild_members WHERE identity_id = $1', [targetId]);
    return { kicked: true, identity_id: targetId };
  }

  async getGuildForIdentity(identityId) {
    return this._getMembership(identityId);
  }

  async getGuildInfo(identityId) {
    const membership = await this._getMembership(identityId);
    if (!membership) return { guild: null };
    const membersResult = await this.pool.query(
      `SELECT m.identity_id, m.role, m.joined_at, i.fingerprint
       FROM guild_members m
       JOIN identities i ON i.id = m.identity_id
       WHERE m.guild_id = $1
       ORDER BY m.role ASC, m.joined_at ASC`,
      [membership.id]
    );
    return {
      guild: {
        id: membership.id,
        name: membership.name,
        tag: membership.tag,
        leader_id: membership.leader_id,
        members: membersResult.rows.map(row => ({
          identity_id: row.identity_id,
          fingerprint: row.fingerprint,
          role: row.role,
          joined_at: row.joined_at
        }))
      }
    };
  }
}

export class MemoryGuildStore {
  constructor(resolveFingerprint) {
    if (typeof resolveFingerprint !== 'function') throw new Error('resolveFingerprint is required');
    this.resolveFingerprint = resolveFingerprint;
    this.guilds = new Map(); // id -> { id, name, tag, leader_id }
    this.memberships = new Map(); // identity_id -> { guild_id, role, joined_at }
  }

  async _resolve(fingerprint) {
    const result = await this.resolveFingerprint(fingerprint);
    return result?.identity_id ?? result?.id ?? null;
  }

  async _findByName(name) {
    return [...this.guilds.values()].find(g => g.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  async createGuild(identityId, name, tag) {
    if (this.memberships.has(identityId)) return { error: 'already_in_guild' };
    if (await this._findByName(name)) return { error: 'guild_name_taken' };
    const tagTaken = [...this.guilds.values()].some(g => g.tag.toLowerCase() === tag.toLowerCase());
    if (tagTaken) return { error: 'guild_tag_taken' };
    const guild = {
      id: crypto.randomUUID(),
      name,
      tag: tag.toUpperCase(),
      leader_id: identityId
    };
    this.guilds.set(guild.id, guild);
    this.memberships.set(identityId, { guild_id: guild.id, role: 'leader', joined_at: Date.now() });
    return { guild };
  }

  async joinGuild(identityId, name) {
    if (this.memberships.has(identityId)) return { error: 'already_in_guild' };
    const guild = await this._findByName(name);
    if (!guild) return { error: 'guild_not_found' };
    const memberCount = [...this.memberships.values()].filter(m => m.guild_id === guild.id).length;
    if (memberCount >= MAX_GUILD_MEMBERS) return { error: 'guild_full' };
    this.memberships.set(identityId, { guild_id: guild.id, role: 'member', joined_at: Date.now() });
    return { guild };
  }

  async leaveGuild(identityId) {
    const membership = this.memberships.get(identityId);
    if (!membership) return { error: 'not_in_guild' };
    if (membership.role === 'leader') return { error: 'leader_must_disband' };
    const guildId = membership.guild_id;
    this.memberships.delete(identityId);
    return { left: true, guild_id: guildId };
  }

  async disbandGuild(identityId) {
    const membership = this.memberships.get(identityId);
    if (!membership) return { error: 'not_in_guild' };
    if (membership.role !== 'leader') return { error: 'not_leader' };
    const guildId = membership.guild_id;
    for (const [id, m] of this.memberships) if (m.guild_id === guildId) this.memberships.delete(id);
    this.guilds.delete(guildId);
    return { disbanded: true, guild_id: guildId };
  }

  async kickMember(leaderIdentityId, targetFingerprint) {
    const membership = this.memberships.get(leaderIdentityId);
    if (!membership) return { error: 'not_in_guild' };
    if (membership.role !== 'leader') return { error: 'not_leader' };
    const targetId = await this._resolve(targetFingerprint);
    if (!targetId) return { error: 'identity_not_found' };
    if (targetId === leaderIdentityId) return { error: 'cannot_kick_self' };
    const targetMembership = this.memberships.get(targetId);
    if (!targetMembership || targetMembership.guild_id !== membership.guild_id) return { error: 'not_in_same_guild' };
    this.memberships.delete(targetId);
    return { kicked: true, identity_id: targetId };
  }

  async getGuildForIdentity(identityId) {
    const membership = this.memberships.get(identityId);
    if (!membership) return null;
    const guild = this.guilds.get(membership.guild_id);
    if (!guild) return null;
    return { id: guild.id, name: guild.name, tag: guild.tag, leader_id: guild.leader_id, role: membership.role };
  }

  async getGuildInfo(identityId) {
    const membership = this.memberships.get(identityId);
    if (!membership) return { guild: null };
    const guild = this.guilds.get(membership.guild_id);
    const members = [];
    for (const [id, m] of this.memberships) {
      if (m.guild_id !== guild.id) continue;
      members.push({ identity_id: id, fingerprint: id, role: m.role, joined_at: new Date(m.joined_at).toISOString() });
    }
    return {
      guild: {
        id: guild.id,
        name: guild.name,
        tag: guild.tag,
        leader_id: guild.leader_id,
        members: members.sort((a, b) => a.role.localeCompare(b.role) || a.joined_at.localeCompare(b.joined_at))
      }
    };
  }
}
