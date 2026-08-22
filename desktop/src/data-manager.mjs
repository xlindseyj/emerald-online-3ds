import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getConfigFilePath, getUserDataPath, getVirtualSdPath } from './constants.mjs';

export const BACKUP_FORMAT = 'emerald-online-3ds-local-backup';
export const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 256;

const appFilePattern = /^(?:emerald\.sav|identity\.cfg|stats\.cfg|display\.cfg|online\.cfg|avatars\.t3x|link-backups\/emerald-link-[A-Za-z0-9._-]+\.sav)$/;

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function normalizedRelative(value) {
  return String(value).replaceAll('\\', '/');
}

function isAllowedBackupPath(relativePath) {
  const normalized = normalizedRelative(relativePath);
  return normalized === 'launcher/launcher-config.json' ||
    (normalized.startsWith('sd/') && appFilePattern.test(normalized.slice(3)));
}

function resolveBackupTarget(relativePath) {
  const normalized = normalizedRelative(relativePath);
  if (!isAllowedBackupPath(normalized)) throw new Error(`Backup contains an unsupported path: ${normalized}`);
  if (normalized === 'launcher/launcher-config.json') return getConfigFilePath();
  return path.join(getVirtualSdPath(), ...normalized.slice(3).split('/'));
}

function collectFile(files, absolutePath, relativePath) {
  const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) return;
  if (stat.size > MAX_FILE_BYTES) throw new Error(`${relativePath} is too large to back up safely.`);
  const data = fs.readFileSync(absolutePath);
  files.push({
    path: relativePath,
    size: data.length,
    sha256: sha256(data),
    data: data.toString('base64')
  });
}

function walkLinkBackups(files) {
  const root = path.join(getVirtualSdPath(), 'link-backups');
  const entries = fs.readdirSync(root, { withFileTypes: true, recursive: false, encoding: 'utf8' });
  for (const entry of entries) {
    if (!entry.isFile() || !/^emerald-link-[A-Za-z0-9._-]+\.sav$/.test(entry.name)) continue;
    collectFile(files, path.join(root, entry.name), `sd/link-backups/${entry.name}`);
  }
}

export function createLocalBackup(targetPath, now = new Date()) {
  const files = [];
  collectFile(files, getConfigFilePath(), 'launcher/launcher-config.json');
  for (const name of ['emerald.sav', 'identity.cfg', 'stats.cfg', 'display.cfg', 'online.cfg', 'avatars.t3x']) {
    collectFile(files, path.join(getVirtualSdPath(), name), `sd/${name}`);
  }
  if (fs.statSync(path.join(getVirtualSdPath(), 'link-backups'), { throwIfNoEntry: false })?.isDirectory()) walkLinkBackups(files);

  if (files.length === 0) throw new Error('There is no save, identity, or settings data to back up yet.');
  if (files.length > MAX_FILES) throw new Error('Too many files were found in local data.');
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_BACKUP_BYTES) throw new Error('Local data is too large to back up safely.');

  const archive = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    notice: 'Local-only backup. Contains private save/settings data and may contain an online identity. Never upload or share it.',
    excluded: ['emerald.gba', 'emerald-online-3ds.3dsx', 'gpsp-debug.log', 'update/'],
    files
  };
  const compressed = zlib.gzipSync(Buffer.from(`${JSON.stringify(archive)}\n`, 'utf8'), { level: 9 });
  const temporary = `${targetPath}.tmp`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(temporary, compressed, { mode: 0o600 });
  fs.rmSync(targetPath, { force: true });
  fs.renameSync(temporary, targetPath);
  return { path: targetPath, files: files.length, bytes: totalBytes, includesIdentity: files.some(file => file.path === 'sd/identity.cfg') };
}

export function inspectLocalBackup(sourcePath) {
  const compressed = fs.readFileSync(sourcePath);
  if (compressed.length > MAX_BACKUP_BYTES) throw new Error('Backup file is too large.');
  let archive;
  try {
    archive = JSON.parse(zlib.gunzipSync(compressed, { maxOutputLength: MAX_BACKUP_BYTES }).toString('utf8'));
  } catch {
    throw new Error('This is not a valid Emerald Online 3DS backup.');
  }
  if (archive?.format !== BACKUP_FORMAT || archive.version !== BACKUP_VERSION || !Array.isArray(archive.files)) {
    throw new Error('This backup format is unsupported.');
  }
  if (archive.files.length === 0 || archive.files.length > MAX_FILES) throw new Error('Backup contains an invalid number of files.');

  const seen = new Set();
  const verified = [];
  let totalBytes = 0;
  for (const file of archive.files) {
    const relativePath = normalizedRelative(file?.path);
    if (!isAllowedBackupPath(relativePath) || seen.has(relativePath)) throw new Error('Backup contains an unsupported or duplicate file.');
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')) {
      throw new Error('Backup contains invalid file metadata.');
    }
    const data = Buffer.from(String(file.data ?? ''), 'base64');
    if (data.length !== file.size || sha256(data) !== file.sha256) throw new Error(`Backup integrity check failed for ${relativePath}.`);
    totalBytes += data.length;
    if (totalBytes > MAX_BACKUP_BYTES) throw new Error('Backup contents are too large.');
    seen.add(relativePath);
    verified.push({ path: relativePath, target: resolveBackupTarget(relativePath), data });
  }
  return {
    archive,
    files: verified,
    summary: {
      createdAt: archive.createdAt,
      fileCount: verified.length,
      bytes: totalBytes,
      includesSave: seen.has('sd/emerald.sav'),
      includesIdentity: seen.has('sd/identity.cfg'),
      romExcluded: !seen.has('sd/emerald.gba')
    }
  };
}

export function restoreLocalBackup(sourcePath) {
  const inspected = inspectLocalBackup(sourcePath);
  for (const file of inspected.files) {
    fs.mkdirSync(path.dirname(file.target), { recursive: true });
    const temporary = `${file.target}.restore-tmp`;
    fs.writeFileSync(temporary, file.data, { mode: 0o600 });
    fs.rmSync(file.target, { force: true });
    fs.renameSync(temporary, file.target);
  }
  return inspected.summary;
}

function assertInsideUserData(target) {
  const root = path.resolve(getUserDataPath());
  const resolved = path.resolve(target);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Refusing to delete data outside the application directory.');
  return resolved;
}

export function deleteLocalData() {
  const targets = [
    path.join(getUserDataPath(), 'Azahar'),
    getConfigFilePath(),
    path.join(getUserDataPath(), 'runtime-state.json'),
    path.join(getUserDataPath(), 'updates'),
    path.join(getUserDataPath(), 'diagnostics'),
    path.join(getUserDataPath(), 'crash-state.json')
  ].map(assertInsideUserData);
  let removed = 0;
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
    removed += 1;
  }
  return { removed, romRemoved: true, saveRemoved: true, identityRemoved: true, settingsRemoved: true };
}
