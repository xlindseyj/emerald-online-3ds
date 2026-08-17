import pg from 'pg';
import { PostgresIdentityStore } from '../src/identity-store.mjs';

const USAGE = `Usage: node admin-roles.mjs <grant|revoke> --actor <admin-fingerprint> --target <target-fingerprint> --role <moderator|admin>`;

function parseArgs(argv) {
  const action = argv[0];
  if (!['grant', 'revoke'].includes(action)) return null;
  const args = { action };
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--actor') args.actor = value;
    else if (key === '--target') args.target = value;
    else if (key === '--role') args.role = value;
  }
  if (!args.actor || !args.target || !args.role) return null;
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) { console.error(USAGE); process.exit(1); }

  const databaseConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : process.env.PGHOST
      ? { host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD }
      : null;
  if (!databaseConfig) { console.error('DATABASE_URL or PGHOST is required'); process.exit(1); }

  const pool = new pg.Pool(databaseConfig);
  try {
    await pool.query('SELECT 1');
    if (!process.env.IDENTITY_PEPPER || Buffer.byteLength(process.env.IDENTITY_PEPPER) < 32) {
      console.error('IDENTITY_PEPPER must be at least 32 bytes');
      process.exit(1);
    }
    const store = new PostgresIdentityStore(pool, process.env.IDENTITY_PEPPER);
    const ok = args.action === 'grant'
      ? await store.assignRole(args.actor, args.target, args.role)
      : await store.revokeRole(args.actor, args.target, args.role);
    if (!ok) { console.error('Operation failed: actor must be an admin and target fingerprint must exist'); process.exit(1); }
    console.log(`${args.action === 'grant' ? 'Granted' : 'Revoked'} ${args.role} for ${args.target}`);
  } finally {
    await pool.end();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
