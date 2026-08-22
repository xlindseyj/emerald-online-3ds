#!/usr/bin/env node
// Tiny ops helper to add or remove friendships by fingerprint without a deploy.
// Usage:
//   node tools/friend-admin.mjs add <fingerprint-a> <fingerprint-b>
//   node tools/friend-admin.mjs remove <fingerprint-a> <fingerprint-b>

import fs from 'node:fs';
import pg from 'pg';

const action = process.argv[2];
const fingerprintA = process.argv[3];
const fingerprintB = process.argv[4];

if (!['add', 'remove'].includes(action) || !fingerprintA || !fingerprintB) {
  console.error('Usage: node tools/friend-admin.mjs (add|remove) <fingerprint-a> <fingerprint-b>');
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
  const idA = await resolveIdentity(fingerprintA);
  const idB = await resolveIdentity(fingerprintB);
  if (!idA || !idB) {
    console.error('One or both identities not found');
    process.exit(1);
  }
  if (idA === idB) {
    console.error('Cannot friend an identity with itself');
    process.exit(1);
  }

  if (action === 'add') {
    await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status)
       VALUES ($1, $2, 'accepted')
       ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status = 'accepted', updated_at = now()`,
      [idA, idB]
    );
    console.log(`Friendship added between ${fingerprintA} and ${fingerprintB}`);
  } else if (action === 'remove') {
    await pool.query(
      `DELETE FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [idA, idB]
    );
    console.log(`Friendship removed between ${fingerprintA} and ${fingerprintB}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
} finally {
  await pool.end();
}
