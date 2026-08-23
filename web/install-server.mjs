import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import QRCode from 'qrcode';
import WebSocket, { WebSocketServer } from 'ws';
import pg from 'pg';
import { MemoryIdentityStore, PostgresIdentityStore } from '../server/src/identity-store.mjs';
import { MemoryCommunityStore, PostgresCommunityStore } from '../server/src/community-store.mjs';
import { MemoryStatsStore, PostgresStatsStore } from '../server/src/stats-store.mjs';
import { createCommunityApp } from './community-app.mjs';
import { communityPage, communityScript } from './community-page.mjs';
import { installPage } from './install-page.mjs';
import { createSideStoreSource } from './sidestore-source.mjs';
import { statusPage } from './status-page.mjs';

const root = path.resolve(import.meta.dirname, '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ciaPath = path.join(root, 'release', 'emerald-online-3ds.cia');
const threeDsxPath = path.join(root, 'release', 'emerald-online-3ds.3dsx');
const sourceFilename = `emerald-online-3ds-source-${packageInfo.version}.tar.gz`;
const sourcePath = path.join(root, 'release', sourceFilename);
const checksumsPath = path.join(root, 'release', 'SHA256SUMS');
const unistorePath = path.join(root, 'release', 'emerald-online-3ds.unistore');
const iosIpaPath = process.env.IOS_IPA_PATH
  ? path.resolve(process.env.IOS_IPA_PATH)
  : path.join(root, 'release', 'emerald-online-3ds-ios.ipa');
const desktopDistPath = path.join(root, 'desktop', 'dist');
const desktopInstallerFilename = `EmeraldOnline3DS-Setup-${packageInfo.version}.exe`;
const desktopInstallerPath = path.join(desktopDistPath, desktopInstallerFilename);
const desktopDistEntries = fs.existsSync(desktopDistPath) ? (fs.readdirSync(desktopDistPath, { withFileTypes: true }) ?? []) : [];
const desktopLinuxInstallerFilename = (() => {
  const exactPatterns = [
    `EmeraldOnline3DS-Setup-${packageInfo.version}.AppImage`,
    `EmeraldOnline3DS-Setup-${packageInfo.version}.appimage`,
    `EmeraldOnline3DS-${packageInfo.version}.AppImage`,
    `EmeraldOnline3DS-${packageInfo.version}.appimage`,
    `Emerald Online 3DS Setup ${packageInfo.version}.AppImage`,
    `Emerald Online 3DS Setup ${packageInfo.version}.appimage`
  ];
  const candidates = desktopDistEntries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => !name.toLowerCase().endsWith('.blockmap'))
    .filter(name => {
      if (!name.includes(packageInfo.version)) return false;
      return name.toLowerCase().match(/\.(appimage|deb|rpm|tar\.gz|zip)$/) !== null;
    });
  return exactPatterns.find(name => candidates.includes(name)) ?? candidates[0] ?? null;
})();
const desktopLinuxInstallerPath = desktopLinuxInstallerFilename ? path.join(desktopDistPath, desktopLinuxInstallerFilename) : null;
const desktopLinuxArtifactPresent = desktopLinuxInstallerFilename !== null;
const desktopInstallerPresent = fs.statSync(desktopInstallerPath, { throwIfNoEntry: false })?.isFile() ?? false;
const iosIpaPresent = fs.statSync(iosIpaPath, { throwIfNoEntry: false })?.isFile() ?? false;
const logoPath = path.join(root, 'assets', 'emerald-online-3ds-web-logo.png');
const iconPath = path.join(root, 'assets', 'emerald-online-3ds-icon.png');
const releaseMediaPath = path.join(root, 'assets', 'release-media');
const siteCssPath = path.join(root, 'web', 'site.css');
const communityCssPath = path.join(root, 'web', 'community.css');
const installPageScriptPath = path.join(root, 'web', 'install-page.js');
const host = process.env.INSTALL_HOST ?? '0.0.0.0';
const port = Number(process.env.INSTALL_PORT ?? 8080);
const gameHost = process.env.GAME_UPSTREAM_HOST ?? '127.0.0.1';
const gamePort = Number(process.env.GAME_UPSTREAM_PORT ?? 3210);
const statusHost = process.env.STATUS_UPSTREAM_HOST ?? '127.0.0.1';
const statusPort = Number(process.env.STATUS_UPSTREAM_PORT ?? 3211);
const maxConnections = Number(process.env.MAX_CONNECTIONS ?? 64);
const maxConnectionsPerIp = Number(process.env.MAX_CONNECTIONS_PER_IP ?? 8);

function lanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address.startsWith('192.168.')) return entry.address;
    }
  }
  for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries ?? []) if (entry.family === 'IPv4' && !entry.internal) return entry.address;
  return '127.0.0.1';
}

function clientIp(req) {
  const cloudflare = req.headers['cf-connecting-ip'];
  if (typeof cloudflare === 'string' && cloudflare) return cloudflare;
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',', 1)[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function securityHeaders(extra = {}) {
  return {
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...extra
  };
}

function chooseDownloadContentType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (lower.endsWith('.appimage')) return 'application/octet-stream';
  if (lower.endsWith('.deb')) return 'application/vnd.debian.binary-package';
  if (lower.endsWith('.rpm')) return 'application/x-rpm';
  if (lower.endsWith('.tar.gz')) return 'application/gzip';
  if (lower.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

function readStatus() {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: statusHost, port: statusPort, path: '/health', timeout: 2000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (response.statusCode !== 200 || !parsed.ok) throw new Error('presence server is unhealthy');
          resolve(parsed);
        } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('presence health timeout')));
    request.on('error', reject);
  });
}

const PEAK_WINDOW_MS = 24 * 60 * 60 * 1000;
const peakObservations = [];

function observeAuthenticated(count) {
  const now = Date.now();
  peakObservations.push({ time: now, count: Math.max(0, Number(count) || 0) });
  const cutoff = now - PEAK_WINDOW_MS;
  while (peakObservations.length && peakObservations[0].time < cutoff) peakObservations.shift();
}

function peak24h(current) {
  const cutoff = Date.now() - PEAK_WINDOW_MS;
  let max = Math.max(0, Number(current) || 0);
  for (const observation of peakObservations) {
    if (observation.time >= cutoff && observation.count > max) max = observation.count;
  }
  return max;
}

function boundedDatabaseCheck() {
  if (!databasePool) return Promise.resolve(true);
  return Promise.race([
    databasePool.query('SELECT 1').then(() => true).catch(() => false),
    new Promise(resolve => setTimeout(() => resolve(false), 2000))
  ]);
}

async function readPublicStatus() {
  const [presenceResult, communityReady] = await Promise.all([
    readStatus().then(value => ({ ok: true, value })).catch(() => ({ ok: false, value: null })),
    boundedDatabaseCheck()
  ]);
  const releaseFilesReady = [ciaPath, threeDsxPath, sourcePath, checksumsPath, unistorePath].every(filename => fs.statSync(filename, { throwIfNoEntry: false })?.isFile());
  const services = [
    { id: 'website', name: 'Website and installer', url: `${publicBase}/`, status: 'operational' },
    { id: 'community', name: 'Community forums', url: `${publicBase}/community`, status: communityReady ? 'operational' : 'outage' },
    { id: 'multiplayer', name: 'Multiplayer WSS gateway', url: gamePublicUrl, status: presenceResult.ok ? 'operational' : 'outage' },
    { id: 'downloads', name: 'Current release downloads', url: `${publicBase}/SHA256SUMS`, status: releaseFilesReady ? 'operational' : 'outage' }
  ];
  return { ok: services.every(service => service.status === 'operational'), checkedAt: new Date().toISOString(), release: packageInfo.version, services };
}

function readReleaseChecksums() {
  const sums = {};
  try {
    const content = fs.readFileSync(checksumsPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) sums[parts[1]] = parts[0];
    }
  } catch {
    return sums;
  }
  return sums;
}

function readReleaseInfo() {
  const checksums = readReleaseChecksums();
  return {
    version: packageInfo.version,
    cia_url: `${publicBase}/emerald-online-3ds.cia`,
    threedsx_url: `${publicBase}/emerald-online-3ds.3dsx`,
    desktop_url: desktopInstallerPresent ? `${publicBase}/download/desktop` : null,
    desktop_linux_url: desktopLinuxArtifactPresent ? `${publicBase}/download/desktop-linux` : null,
    ios_url: iosIpaPresent ? `${publicBase}/download/ios` : null,
    sha256_cia: checksums['emerald-online-3ds.cia'] ?? null,
    sha256_threedsx: checksums['emerald-online-3ds.3dsx'] ?? null,
    sha256_desktop: checksums[desktopInstallerFilename] ?? null,
    sha256_desktop_linux: desktopLinuxInstallerFilename ? checksums[desktopLinuxInstallerFilename] ?? null : null,
    sha256_ios: iosIpaPresent ? checksums['emerald-online-3ds-ios.ipa'] ?? null : null,
    release_notes_url: `${publicBase}/`
  };
}

if (!Number.isSafeInteger(port) || port < 1 || port > 65535 ||
    !Number.isSafeInteger(gamePort) || gamePort < 1 || gamePort > 65535 ||
    !Number.isSafeInteger(statusPort) || statusPort < 1 || statusPort > 65535 ||
    !Number.isSafeInteger(maxConnections) || maxConnections < 1 ||
    !Number.isSafeInteger(maxConnectionsPerIp) || maxConnectionsPerIp < 1) throw new Error('invalid installer server configuration');
for (const artifact of [ciaPath, threeDsxPath, sourcePath, checksumsPath, unistorePath, logoPath, iconPath]) {
  if (!fs.existsSync(artifact)) throw new Error(`release artifact missing: ${artifact}. Run npm run build:public first.`);
}

const publicBase = (process.env.PUBLIC_BASE_URL ?? `http://${lanAddress()}:${port}`).replace(/\/$/, '');
const gamePublicUrl = process.env.GAME_PUBLIC_URL ?? `ws://${lanAddress()}:${port}/game`;
const ciaUrl = `${publicBase}/emerald-online-3ds.cia`;
const qrSvg = await QRCode.toString(ciaUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 360 });
const databaseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : process.env.PGHOST
    ? { host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD }
    : null;
let databasePool = null;
let identityStore;
let communityStore;
let statsStore;
if (databaseConfig) {
  const ssl = process.env.DATABASE_CA_PATH
    ? { ca: fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8'), rejectUnauthorized: true }
    : undefined;
  databasePool = new pg.Pool({ ...databaseConfig, max: Number(process.env.COMMUNITY_DATABASE_POOL_SIZE ?? 5), ssl });
  await databasePool.query('SELECT 1');
  identityStore = new PostgresIdentityStore(databasePool, process.env.IDENTITY_PEPPER);
  communityStore = new PostgresCommunityStore(databasePool);
  statsStore = new PostgresStatsStore(databasePool);
} else {
  identityStore = new MemoryIdentityStore();
  communityStore = new MemoryCommunityStore();
  statsStore = new MemoryStatsStore();
}
const community = createCommunityApp({ identityStore, communityStore, statsStore, secureCookies: publicBase.startsWith('https://'), page: communityPage });
const releaseCatalog = JSON.parse(fs.readFileSync(path.join(root, 'release', 'release-catalog.json'), 'utf8'));
const currentRelease = releaseCatalog.find(entry => entry.version === packageInfo.version);
if (!currentRelease) throw new Error(`release catalog missing current version ${packageInfo.version}`);
const sideStoreSource = createSideStoreSource({
  publicBase,
  version: packageInfo.version,
  releasedAt: currentRelease.releasedAt,
  releaseSummary: currentRelease.summary,
  ipaSize: iosIpaPresent ? fs.statSync(iosIpaPath).size : null
});

const page = installPage({
  version: packageInfo.version,
  publicBase,
  gamePublicUrl,
  ciaUrl,
  desktopInstallerPresent,
  desktopLinuxInstallerPresent: desktopLinuxArtifactPresent,
  iosIpaPresent
});
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;
  const webAssets = new Map([
    ['/site.css', [siteCssPath, 'text/css; charset=utf-8']],
    ['/community.css', [communityCssPath, 'text/css; charset=utf-8']],
    ['/install-page.js', [installPageScriptPath, 'text/javascript; charset=utf-8']]
  ]);
  if (webAssets.has(pathname)) {
    const [filename, contentType] = webAssets.get(pathname);
    const stat = fs.statSync(filename);
    res.writeHead(200, securityHeaders({ 'content-type': contentType, 'content-length': stat.size, 'cache-control': 'public, max-age=300' }));
    fs.createReadStream(filename).pipe(res);
    return;
  }
  if (pathname === '/community.js') {
    res.writeHead(200, securityHeaders({ 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }));
    res.end(communityScript);
    return;
  }
  if (await community(req, res, url)) return;
  if (pathname === '/') {
    res.writeHead(200, securityHeaders({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }));
    res.end(page);
    return;
  }
  if (pathname === '/status') {
    res.writeHead(200, securityHeaders({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }));
    res.end(statusPage(packageInfo.version));
    return;
  }
  if (pathname === '/qr.svg') {
    res.writeHead(200, securityHeaders({ 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=300' }));
    res.end(qrSvg);
    return;
  }
  const images = new Map([
    ['/logo.png', logoPath],
    ['/favicon.png', iconPath],
  ]);
  if (images.has(pathname)) {
    const filename = images.get(pathname);
    const stat = fs.statSync(filename);
    res.writeHead(200, securityHeaders({
      'content-type': 'image/png',
      'content-length': stat.size,
      'cache-control': 'public, max-age=86400, immutable'
    }));
    fs.createReadStream(filename).pipe(res);
    return;
  }
  const releaseMedia = pathname.match(/^\/release-media\/([a-z0-9][a-z0-9._-]*\.(?:png|jpg|jpeg|webp|svg))$/i);
  if (releaseMedia) {
    const filename = path.join(releaseMediaPath, releaseMedia[1]);
    if (fs.existsSync(filename) && fs.statSync(filename).isFile()) {
      const extension = path.extname(filename).toLowerCase();
      const contentType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : extension === '.svg' ? 'image/svg+xml' : 'image/jpeg';
      const stat = fs.statSync(filename);
      res.writeHead(200, securityHeaders({ 'content-type': contentType, 'content-length': stat.size, 'cache-control': 'public, max-age=86400, immutable' }));
      fs.createReadStream(filename).pipe(res);
      return;
    }
  }
  if (pathname === '/emerald-online-3ds.cia') {
    const stat = fs.statSync(ciaPath);
    res.writeHead(200, securityHeaders({
      'content-type': 'application/octet-stream',
      'content-length': stat.size,
      'content-disposition': 'attachment; filename="emerald-online-3ds.cia"',
      'cache-control': 'public, max-age=300'
    }));
    fs.createReadStream(ciaPath).pipe(res);
    return;
  }
  const downloads = new Map([
    ['/emerald-online-3ds.3dsx', [threeDsxPath, 'emerald-online-3ds.3dsx', 'application/octet-stream']],
    ['/source', [sourcePath, sourceFilename, 'application/gzip']],
    ['/SHA256SUMS', [checksumsPath, 'SHA256SUMS', 'text/plain; charset=utf-8']],
    ['/emerald-online-3ds.unistore', [unistorePath, 'emerald-online-3ds.unistore', 'application/json']],
  ]);
  if (downloads.has(pathname)) {
    const [filename, downloadName, contentType] = downloads.get(pathname);
    const stat = fs.statSync(filename);
    res.writeHead(200, securityHeaders({
      'content-type': contentType,
      'content-length': stat.size,
      'content-disposition': `attachment; filename="${downloadName}"`,
      'cache-control': 'public, max-age=300'
    }));
    fs.createReadStream(filename).pipe(res);
    return;
  }
  if (pathname === '/download/desktop') {
    if (!desktopInstallerPresent) {
      res.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
      res.end('Windows desktop installer is not available in this deployment.');
      return;
    }
    const stat = fs.statSync(desktopInstallerPath);
    res.writeHead(200, securityHeaders({
      'content-type': 'application/vnd.microsoft.portable-executable',
      'content-length': stat.size,
      'content-disposition': `attachment; filename="${desktopInstallerFilename}"`,
      'cache-control': 'public, max-age=300'
    }));
    fs.createReadStream(desktopInstallerPath).pipe(res);
    return;
  }
  if (pathname === '/download/desktop-linux') {
    if (!desktopLinuxArtifactPresent || !desktopLinuxInstallerPath) {
      res.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
      res.end('Linux desktop artifact is not available in this deployment.');
      return;
    }
    const stat = fs.statSync(desktopLinuxInstallerPath);
    res.writeHead(200, securityHeaders({
      'content-type': chooseDownloadContentType(desktopLinuxInstallerFilename),
      'content-length': stat.size,
      'content-disposition': `attachment; filename="${desktopLinuxInstallerFilename}"`,
      'cache-control': 'public, max-age=300'
    }));
    fs.createReadStream(desktopLinuxInstallerPath).pipe(res);
    return;
  }
  if (pathname === '/download/ios') {
    if (!iosIpaPresent) {
      res.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
      res.end('The signed iOS sideload build is not available in this deployment.');
      return;
    }
    const stat = fs.statSync(iosIpaPath);
    res.writeHead(200, securityHeaders({
      'content-type': 'application/octet-stream',
      'content-length': stat.size,
      'content-disposition': 'attachment; filename="emerald-online-3ds-ios.ipa"',
      'cache-control': 'public, max-age=300'
    }));
    fs.createReadStream(iosIpaPath).pipe(res);
    return;
  }
  if (pathname === '/health') {
    try {
      const presence = await readStatus();
      res.writeHead(200, securityHeaders({ 'content-type': 'application/json', 'cache-control': 'no-store' }));
      res.end(JSON.stringify({ ...presence, ciaUrl, gameUrl: gamePublicUrl }));
    } catch {
      res.writeHead(503, securityHeaders({ 'content-type': 'application/json', 'cache-control': 'no-store' }));
      res.end(JSON.stringify({ ok: false, error: 'presence_unavailable', ciaUrl, gameUrl: gamePublicUrl }));
    }
    return;
  }
  if (pathname === '/api/status') {
    try {
      const presence = await readStatus();
      observeAuthenticated(presence.authenticated);
      const registered = await identityStore.count();
      res.writeHead(200, securityHeaders({ 'content-type': 'application/json', 'cache-control': 'no-store' }));
      res.end(JSON.stringify({ ...presence, registered, peak24h: peak24h(presence.authenticated), ciaUrl, gameUrl: gamePublicUrl }));
    } catch {
      res.writeHead(503, securityHeaders({ 'content-type': 'application/json', 'cache-control': 'no-store' }));
      res.end(JSON.stringify({ ok: false, error: 'presence_unavailable', ciaUrl, gameUrl: gamePublicUrl }));
    }
    return;
  }
  if (pathname === '/api/public-status') {
    const result = await readPublicStatus();
    res.writeHead(result.ok ? 200 : 503, securityHeaders({ 'content-type': 'application/json', 'cache-control': 'no-store' }));
    res.end(JSON.stringify(result));
    return;
  }
  if (pathname === '/api/release') {
    res.writeHead(200, securityHeaders({ 'content-type': 'application/json', 'cache-control': 'no-store' }));
    res.end(JSON.stringify(readReleaseInfo()));
    return;
  }
  if (pathname === '/sidecommunity.json') {
    res.writeHead(200, securityHeaders({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }));
    res.end(JSON.stringify(sideStoreSource));
    return;
  }
  res.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
  res.end('Not found');
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 8192, clientTracking: true });
const connectionsByIp = new Map();

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  const ip = clientIp(req);
  const ipConnections = connectionsByIp.get(ip) ?? 0;
  if (pathname !== '/game') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (wss.clients.size >= maxConnections || ipConnections >= maxConnectionsPerIp) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 5\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    connectionsByIp.set(ip, ipConnections + 1);
    wss.emit('connection', ws, req, ip);
  });
});

wss.on('connection', (ws, _req, ip) => {
  const upstream = net.createConnection({ host: gameHost, port: gamePort });
  const pending = [];
  let connected = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
    if (remaining > 0) connectionsByIp.set(ip, remaining); else connectionsByIp.delete(ip);
  };
  upstream.setNoDelay(true);
  upstream.on('connect', () => {
    connected = true;
    for (const message of pending.splice(0)) upstream.write(message);
  });
  upstream.on('data', data => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: true, compress: false });
  });
  upstream.on('error', () => {
    if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'presence unavailable');
  });
  upstream.on('close', () => {
    if (ws.readyState === WebSocket.OPEN) ws.close(1012, 'presence restarting');
  });
  ws.on('message', data => {
    const message = Buffer.from(data);
    if (connected) upstream.write(message);
    else if (pending.reduce((total, entry) => total + entry.length, 0) + message.length <= 8192) pending.push(message);
    else ws.close(1009, 'message buffer full');
  });
  ws.on('error', () => upstream.destroy());
  ws.on('close', () => { upstream.destroy(); release(); });
});

server.listen(port, host, () => console.log(`Installer page: ${publicBase}/\nFBI CIA URL: ${ciaUrl}\nGame WebSocket: ${gamePublicUrl}`));
