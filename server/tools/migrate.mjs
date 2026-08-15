import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const databaseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : process.env.PGHOST
    ? { host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD }
    : null;
if (!databaseConfig) throw new Error('DATABASE_URL or PGHOST configuration is required');
const directory = path.resolve(import.meta.dirname, '..', 'migrations');
const ssl = process.env.DATABASE_CA_PATH
  ? { ca: fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8'), rejectUnauthorized: true }
  : undefined;
const pool = new pg.Pool({ ...databaseConfig, max: 1, ssl });
const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock(187965291)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await fsp.readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const exists = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [file]);
    if (exists.rowCount) continue;
    const sql = await fsp.readFile(path.join(directory, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(187965291)').catch(() => {});
  client.release();
  await pool.end();
}
