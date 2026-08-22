#!/usr/bin/env node
// Tiny ops helper to manage guilds by fingerprint without a deploy.
// Usage:
//   node tools/guild-admin.mjs create <leader-fingerprint> <name> <tag>
//   node tools/guild-admin.mjs disband <leader-fingerprint>
//   node tools/guild-admin.mjs kick <leader-fingerprint> <member-fingerprint>

import fs from 'node:fs';
import pg from 'pg';

const action = process.argv[2];

async function parseArgs() {
  if (action === 'create') {
    const fingerprint = process.argv[3];
    const name = process.argv[4];
    const tag = process.argv[5];
    if (!fingerprint || !name || !tag) {
      console.error('Usage: node tools/guild-admin.mjs create <leader-fingerprint> <name> <tag>');
      process.exit(1);
    }
    return { fingerprint, name, tag };
  }
  if (action === 'disband') {
    const fingerprint = process.argv[3];
    if (!fingerprint) {
      console.error('Usage: node tools/guild-admin.mjs disband <leader-fingerprint>');
      process.exit(1);
    }
    return { fingerprint };
  }
  if (action === 'kick') {
    const leaderFingerprint = process.argv[3];
    const memberFingerprint = process.argv[4];
    if (!leaderFingerprint || !memberFingerprint) {
      console.error('Usage: node tools/guild-admin.mjs kick <leader-fingerprint> <member-fingerprint>');
      process.exit(1);
    }
    return { leaderFingerprint, memberFingerprint };
  }
  console.error('Usage: node tools/guild-admin.mjs (create|disband|kick) ...');
  process.exit(1);
}

const args = await parseArgs();

const databaseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : process.env.PGHOST
    ? {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT ?? 5432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD
      }
    : null;

if (!databaseConfig) {
  console.error('DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD must be set');
  process.exit(1);
}

const ssl = process.env.DATABASE_CA_PATH
  ? { ca: await fs.promises.readFile(process.env.DATABASE_CA_PATH, 'utf8'), rejectUnauthorized: true }
  : undefined;

const pool = new pg.Pool({ ...databaseConfig, ssl });

async function resolveIdentity(fp) {
  const result = await pool.query(
    'SELECT id FROM identities WHERE fingerprint = $1 AND deleted_at IS NULL',
    [fp]
  );
  return result.rows[0]?.id ?? null;
}

try {
  if (action === 'create') {
    const identityId = await resolveIdentity(args.fingerprint);
    if (!identityId) {
      console.error(`Identity ${args.fingerprint} not found`);
      process.exit(1);
    }
    const existing = await pool.query(
      'SELECT 1 FROM guild_members WHERE identity_id = $1',
      [identityId]
    );
    if (existing.rowCount) {
      console.error(`Identity ${args.fingerprint} is already in a guild`);
      process.exit(1);
    }
    const nameCheck = await pool.query('SELECT 1 FROM guilds WHERE LOWER(name) = LOWER($1)', [args.name]);
    if (nameCheck.rowCount) {
      console.error(`Guild name "${args.name}" is already taken`);
      process.exit(1);
    }
    const tagCheck = await pool.query('SELECT 1 FROM guilds WHERE LOWER(tag) = LOWER($1)', [args.tag]);
    if (tagCheck.rowCount) {
      console.error(`Guild tag "${args.tag}" is already taken`);
      process.exit(1);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const guildResult = await client.query(
        'INSERT INTO guilds (name, tag, leader_id) VALUES ($1, $2, $3) RETURNING id, name, tag',
        [args.name, args.tag.toUpperCase(), identityId]
      );
      const guild = guildResult.rows[0];
      await client.query(
        'INSERT INTO guild_members (identity_id, guild_id, role) VALUES ($1, $2, $3)',
        [identityId, guild.id, 'leader']
      );
      await client.query('COMMIT');
      console.log(`Created guild [${guild.tag}] ${guild.name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else if (action === 'disband') {
    const identityId = await resolveIdentity(args.fingerprint);
    if (!identityId) {
      console.error(`Identity ${args.fingerprint} not found`);
      process.exit(1);
    }
    const membership = await pool.query(
      `SELECT g.id FROM guild_members m
       JOIN guilds g ON g.id = m.guild_id
       WHERE m.identity_id = $1 AND m.role = 'leader'`,
      [identityId]
    );
    if (!membership.rowCount) {
      console.error(`Identity ${args.fingerprint} is not a guild leader`);
      process.exit(1);
    }
    await pool.query('DELETE FROM guilds WHERE id = $1', [membership.rows[0].id]);
    console.log(`Disbanded guild for ${args.fingerprint}`);
  } else if (action === 'kick') {
    const leaderId = await resolveIdentity(args.leaderFingerprint);
    const memberId = await resolveIdentity(args.memberFingerprint);
    if (!leaderId || !memberId) {
      console.error('One or both identities not found');
      process.exit(1);
    }
    const membership = await pool.query(
      `SELECT g.id FROM guild_members m
       JOIN guilds g ON g.id = m.guild_id
       WHERE m.identity_id = $1 AND m.role = 'leader'`,
      [leaderId]
    );
    if (!membership.rowCount) {
      console.error(`${args.leaderFingerprint} is not a guild leader`);
      process.exit(1);
    }
    const guildId = membership.rows[0].id;
    const targetMembership = await pool.query(
      'SELECT 1 FROM guild_members WHERE identity_id = $1 AND guild_id = $2',
      [memberId, guildId]
    );
    if (!targetMembership.rowCount) {
      console.error(`${args.memberFingerprint} is not in the same guild`);
      process.exit(1);
    }
    await pool.query('DELETE FROM guild_members WHERE identity_id = $1', [memberId]);
    console.log(`Kicked ${args.memberFingerprint} from guild`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
} finally {
  await pool.end();
}
