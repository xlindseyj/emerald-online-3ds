import fs from 'node:fs';
import pg from 'pg';

const databaseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : process.env.PGHOST
    ? { host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD }
    : null;
if (!databaseConfig) throw new Error('DATABASE_URL or PGHOST configuration is required');
const ssl = process.env.DATABASE_CA_PATH
  ? { ca: fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8'), rejectUnauthorized: true }
  : undefined;
const pool = new pg.Pool({ ...databaseConfig, max: 1, ssl });

try {
  const result = await pool.query(`
    WITH expired_pairing AS (
      DELETE FROM pairing_codes WHERE expires_at < now() RETURNING 1
    ), expired_sessions AS (
      DELETE FROM browser_sessions
      WHERE expires_at < now() OR last_used_at < now() - interval '30 days'
      RETURNING 1
    ), expired_security AS (
      DELETE FROM security_events WHERE expires_at IS NOT NULL AND expires_at < now() RETURNING 1
    ), expired_audit AS (
      DELETE FROM moderation_audit WHERE expires_at < now() RETURNING 1
    )
    SELECT
      (SELECT count(*)::int FROM expired_pairing) AS pairing_codes,
      (SELECT count(*)::int FROM expired_sessions) AS browser_sessions,
      (SELECT count(*)::int FROM expired_security) AS security_events,
      (SELECT count(*)::int FROM expired_audit) AS moderation_audit
  `);
  console.log(JSON.stringify({ ok: true, deleted: result.rows[0] }));
} finally {
  await pool.end();
}
