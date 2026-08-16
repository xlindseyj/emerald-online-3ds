import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { PostgresCommunityStore } from '../src/community-store.mjs';
import { formatReleaseTopic, releaseContentHash, validateReleaseCatalog } from '../src/release-catalog.mjs';
import { formatKnownIssueTopic, knownIssueContentHash, validateKnownIssueCatalog } from '../src/known-issue-catalog.mjs';

const catalogPath = path.resolve(import.meta.dirname, '..', '..', 'release', 'release-catalog.json');
const catalog = validateReleaseCatalog(JSON.parse(await fsp.readFile(catalogPath, 'utf8')));
const packageInfo = JSON.parse(await fsp.readFile(path.resolve(import.meta.dirname, '..', '..', 'package.json'), 'utf8'));
const sums = new Map((await fsp.readFile(path.resolve(import.meta.dirname, '..', '..', 'release', 'SHA256SUMS'), 'utf8')).trim().split('\n').map(line => {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  if (!match) throw new Error(`invalid SHA256SUMS line: ${line}`);
  return [match[2], match[1]];
}));
const current = catalog.at(-1);
if (current.version !== packageInfo.version) throw new Error(`latest catalog release ${current.version} does not match package ${packageInfo.version}`);
const currentArtifacts = new Map(current.artifacts.map(artifact => [artifact.label, artifact.sha256]));
for (const [label, filename] of [['CIA', 'emerald-online-3ds.cia'], ['3DSX', 'emerald-online-3ds.3dsx'], ['Corresponding source', `emerald-online-3ds-source-${packageInfo.version}.tar.gz`]]) {
  if (currentArtifacts.get(label) !== sums.get(filename)) throw new Error(`${label} catalog hash does not match SHA256SUMS`);
}
const publications = catalog.map(release => {
  const topic = formatReleaseTopic(release);
  return { ...release, ...topic, contentHash: releaseContentHash(release, topic) };
});
const knownIssues = validateKnownIssueCatalog(JSON.parse(await fsp.readFile(path.resolve(import.meta.dirname, '..', '..', 'release', 'known-issues.json'), 'utf8'))).map(issue => {
  const topic = formatKnownIssueTopic(issue);
  return { ...issue, ...topic, contentHash: knownIssueContentHash(issue, topic) };
});

if (process.argv.includes('--validate-only')) {
  console.log(`Validated ${publications.length} release publication${publications.length === 1 ? '' : 's'} and ${knownIssues.length} known issue${knownIssues.length === 1 ? '' : 's'}; latest release is ${publications.at(-1).version}.`);
  process.exit(0);
}

const databaseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : process.env.PGHOST
    ? { host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD }
    : null;
if (!databaseConfig) throw new Error('DATABASE_URL or PGHOST configuration is required');
const ssl = process.env.DATABASE_CA_PATH ? { ca: fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8'), rejectUnauthorized: true } : undefined;
const pool = new pg.Pool({ ...databaseConfig, max: 1, ssl });
try {
  const store = new PostgresCommunityStore(pool);
  for (const publication of publications) await store.upsertOfficialRelease(publication);
  await store.pinLatestOfficialRelease(publications.at(-1).version);
  for (const issue of knownIssues) await store.upsertOfficialKnownIssue(issue);
  console.log(`Published ${publications.length} idempotent release topic${publications.length === 1 ? '' : 's'} and ${knownIssues.length} known issue${knownIssues.length === 1 ? '' : 's'}; latest release is ${publications.at(-1).version}.`);
} finally {
  await pool.end();
}
