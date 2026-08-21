import fs from 'node:fs';
import path from 'node:path';
import { getConfigFilePath, DEFAULTS, SUPPORTED_PAGES } from './constants.mjs';

export function sanitizeTrainerName(name) {
  const trimmed = String(name ?? '').trim();
  if (!/^[\x20-!#-\[\]-~]{1,12}$/.test(trimmed)) {
    throw new Error('Trainer name must be 1-12 printable ASCII characters without quotes or backslashes.');
  }
  return trimmed;
}

export function sanitizeServerHost(host) {
  const trimmed = String(host ?? '').trim().toLowerCase();
  if (!trimmed || trimmed.length > 253 || /[\s/:\\]/.test(trimmed)) {
    throw new Error('Server host must be a hostname or IPv4 address without a scheme, path, or port.');
  }

  const ipv4 = trimmed.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    if (ipv4.slice(1).some(part => Number(part) > 255)) throw new Error('Server host contains an invalid IPv4 address.');
    return trimmed;
  }

  if (trimmed !== 'localhost' && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(trimmed)) {
    throw new Error('Server host contains invalid hostname characters.');
  }
  return trimmed;
}

export function sanitizeServerPath(serverPath) {
  const trimmed = String(serverPath ?? '').trim();
  if (!trimmed.startsWith('/')) throw new Error('Server path must start with /.');
  if (trimmed.length > 127) throw new Error('Server path is too long.');
  if (!/^\/[\x21-\x7e]*$/.test(trimmed) || /[?#\\]/.test(trimmed)) {
    throw new Error('Server path contains unsupported characters.');
  }
  return trimmed;
}

export function normalizeConfig(config = {}) {
  const port = Number(config.port ?? DEFAULTS.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer between 1 and 65535.');

  const transport = String(config.transport ?? DEFAULTS.transport).toLowerCase();
  if (!['wss', 'tcp'].includes(transport)) throw new Error('Transport must be wss or tcp.');

  const page = String(config.page ?? DEFAULTS.page).toLowerCase();
  if (!SUPPORTED_PAGES.includes(page)) throw new Error('Invalid starting page.');

  return {
    server: sanitizeServerHost(config.server ?? DEFAULTS.server),
    port,
    transport,
    path: sanitizeServerPath(config.path ?? DEFAULTS.path),
    name: sanitizeTrainerName(config.name ?? DEFAULTS.name),
    online: config.online === undefined ? DEFAULTS.online : Boolean(config.online),
    page
  };
}

export function readConfig() {
  try {
    const raw = fs.readFileSync(getConfigFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeConfig({ ...DEFAULTS, ...parsed });
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeConfig(config) {
  const normalized = normalizeConfig(config);
  const target = getConfigFilePath();
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
  return normalized;
}
