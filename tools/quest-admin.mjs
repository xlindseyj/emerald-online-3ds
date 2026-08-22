#!/usr/bin/env node
// Tiny ops helper to enable or disable online NPCs and quests without a deploy.
// Usage:
//   node tools/quest-admin.mjs npc <slug> <true|false>
//   node tools/quest-admin.mjs quest <slug> <true|false>

import fs from 'node:fs';
import pg from 'pg';

const kind = process.argv[2];
const slug = process.argv[3];
const active = process.argv[4];

if (!['npc', 'quest'].includes(kind) || !slug || !['true', 'false'].includes(active)) {
  console.error('Usage: node tools/quest-admin.mjs (npc|quest) <slug> <true|false>');
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

try {
  const table = kind === 'npc' ? 'npc_spawns' : 'quests';
  const result = await pool.query(
    `UPDATE ${table} SET active = $1 WHERE slug = $2 RETURNING slug, active`,
    [active === 'true', slug]
  );
  if (!result.rowCount) {
    console.error(`${kind} "${slug}" not found`);
    process.exit(1);
  }
  console.log(`${kind} "${result.rows[0].slug}" active=${result.rows[0].active}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
} finally {
  await pool.end();
}
