#!/usr/bin/env node
// Tiny ops helper to grant, revoke, or equip titles without a deploy.
// Usage:
//   node tools/title-admin.mjs grant <fingerprint> <title>
//   node tools/title-admin.mjs revoke <fingerprint> <title>
//   node tools/title-admin.mjs equip <fingerprint> <title>

import fs from 'node:fs';
import pg from 'pg';

const action = process.argv[2];
const fingerprint = process.argv[3];
const title = process.argv[4];

if (!['grant', 'revoke', 'equip'].includes(action) || !fingerprint || !title) {
  console.error('Usage: node tools/title-admin.mjs (grant|revoke|equip) <fingerprint> <title>');
  process.exit(1);
}

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
  const identityId = await resolveIdentity(fingerprint);
  if (!identityId) {
    console.error(`Identity ${fingerprint} not found`);
    process.exit(1);
  }

  if (action === 'grant') {
    await pool.query(
      `INSERT INTO player_titles (identity_id, title, unlocked_at)
       VALUES ($1, $2, now())
       ON CONFLICT (identity_id, title) DO NOTHING`,
      [identityId, title]
    );
    const equipped = await pool.query('SELECT title FROM identity_titles WHERE identity_id = $1', [identityId]);
    if (!equipped.rowCount) {
      await pool.query(
        `INSERT INTO identity_titles (identity_id, title, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (identity_id) DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
        [identityId, title]
      );
    }
    console.log(`Granted "${title}" to ${fingerprint}`);
  } else if (action === 'revoke') {
    const client = await pool.connect();
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
      console.log(`Revoked "${title}" from ${fingerprint}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else if (action === 'equip') {
    const owned = await pool.query(
      'SELECT 1 FROM player_titles WHERE identity_id = $1 AND title = $2',
      [identityId, title]
    );
    if (!owned.rowCount) {
      console.error(`Identity ${fingerprint} does not own title "${title}"`);
      process.exit(1);
    }
    await pool.query(
      `INSERT INTO identity_titles (identity_id, title, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (identity_id) DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
      [identityId, title]
    );
    console.log(`Equipped "${title}" for ${fingerprint}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
} finally {
  await pool.end();
}
