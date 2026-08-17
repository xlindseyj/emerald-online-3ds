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
import { statusPage } from './status-page.mjs';

const root = path.resolve(import.meta.dirname, '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ciaPath = path.join(root, 'release', 'emerald-online-3ds.cia');
const threeDsxPath = path.join(root, 'release', 'emerald-online-3ds.3dsx');
const sourceFilename = `emerald-online-3ds-source-${packageInfo.version}.tar.gz`;
const sourcePath = path.join(root, 'release', sourceFilename);
const checksumsPath = path.join(root, 'release', 'SHA256SUMS');
const logoPath = path.join(root, 'assets', 'emerald-online-3ds-web-logo.png');
const iconPath = path.join(root, 'assets', 'emerald-online-3ds-icon.png');
const releaseMediaPath = path.join(root, 'assets', 'release-media');
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
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...extra
  };
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
  const releaseFilesReady = [ciaPath, threeDsxPath, sourcePath, checksumsPath].every(filename => fs.statSync(filename, { throwIfNoEntry: false })?.isFile());
  const services = [
    { id: 'website', name: 'Website and installer', url: `${publicBase}/`, status: 'operational' },
    { id: 'community', name: 'Community forums', url: `${publicBase}/community`, status: communityReady ? 'operational' : 'outage' },
    { id: 'multiplayer', name: 'Multiplayer WSS gateway', url: gamePublicUrl, status: presenceResult.ok ? 'operational' : 'outage' },
    { id: 'downloads', name: 'Current release downloads', url: `${publicBase}/SHA256SUMS`, status: releaseFilesReady ? 'operational' : 'outage' }
  ];
  return { ok: services.every(service => service.status === 'operational'), checkedAt: new Date().toISOString(), release: packageInfo.version, services };
}

if (!Number.isSafeInteger(port) || port < 1 || port > 65535 ||
    !Number.isSafeInteger(gamePort) || gamePort < 1 || gamePort > 65535 ||
    !Number.isSafeInteger(statusPort) || statusPort < 1 || statusPort > 65535 ||
    !Number.isSafeInteger(maxConnections) || maxConnections < 1 ||
    !Number.isSafeInteger(maxConnectionsPerIp) || maxConnectionsPerIp < 1) throw new Error('invalid installer server configuration');
for (const artifact of [ciaPath, threeDsxPath, sourcePath, checksumsPath, logoPath, iconPath]) {
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

let page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/png" href="/favicon.png">
<meta name="description" content="Install Emerald Online 3DS, see verified Union Room trading, and check the public service status.">
<title>Emerald Online 3DS</title><style>
:root{color-scheme:dark;font-family:ui-rounded,system-ui,sans-serif;background:#061b16;color:#effff8}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 12% 0,#176348,#061b16 52%);padding:32px 16px}main{width:min(980px,100%);margin:auto}.hero,.card,.showcase{border:1px solid #65d6a255;border-radius:24px;background:#09251fe8;box-shadow:0 24px 80px #0007}.hero{display:grid;grid-template-columns:1fr clamp(112px,22vw,190px);align-items:center;gap:28px;padding:34px;margin-bottom:22px}.hero-copy{min-width:0}.hero-logo{display:block;width:100%;height:auto;border-radius:23%;filter:drop-shadow(0 16px 25px #0008)}.eyebrow{color:#71e6ad;font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:.78rem}h1{font-size:clamp(2.2rem,7vw,4.8rem);line-height:.96;margin:.35em 0 .25em;color:#eafff5}h1 span{color:#6ce0a7}.lede{max-width:680px;color:#bfe9d5;font-size:1.08rem}.status{display:inline-flex;align-items:center;gap:9px;margin-top:12px;padding:8px 12px;border-radius:999px;background:#0e342a;color:#d9ffed}.dot{width:10px;height:10px;border-radius:50%;background:#f3c969;box-shadow:0 0 14px #f3c969}body.ready .dot{background:#58e49b;box-shadow:0 0 14px #58e49b}.grid{display:grid;grid-template-columns:minmax(250px,360px) 1fr;gap:22px}.card{padding:26px}.qr{padding:14px;background:white;border-radius:18px;line-height:0}.qr svg{width:100%;height:auto}code{word-break:break-all;color:#9de9c4}.button{display:inline-block;margin:10px 10px 0 0;padding:13px 18px;border-radius:11px;background:#51d596;color:#052017;text-decoration:none;font-weight:800}.warning{color:#ffd68a}.endpoint,pre{padding:13px;border-radius:12px;background:#061b16;border:1px solid #4e9f7a55}pre{overflow:auto;color:#bff5da;line-height:1.55}li{margin:.55em 0}.showcase{margin-top:22px;padding:26px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.info-grid h3{margin-top:0}.shots{display:grid;grid-template-columns:1fr 1fr;gap:18px}.shots figure{margin:0}.shots img{display:block;width:100%;aspect-ratio:16/10;object-fit:contain;background:#04120f;border:1px solid #65d6a244;border-radius:14px}.shots figcaption{color:#a9d2c0;font-size:.86rem;line-height:1.45;margin-top:9px}.site-footer{margin-top:26px;padding:24px 4px 8px;border-top:1px solid #65d6a244;color:#acd6c3;font-size:.86rem;line-height:1.55}.site-footer h2{margin:0 0 8px;color:#dfffee;font-size:1rem}.site-footer p{margin:8px 0}.site-footer nav{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:14px}.site-footer a,.showcase a{color:#75e3ae}.legal{color:#91bbaa}@media(max-width:720px){.grid,.shots,.info-grid{grid-template-columns:1fr}.hero{grid-template-columns:1fr}.hero-logo{width:118px;grid-row:1;justify-self:start}.hero,.card,.showcase{padding:22px}body{padding:18px 12px}}
</style></head><body><main><section class="hero"><div class="hero-copy"><div class="eyebrow">Public multiplayer presence service · v${packageInfo.version}</div><h1>Emerald <span>Online</span> 3DS</h1><p class="lede">Play your own legally obtained Emerald copy on 3DS while seeing trainers on the same map, chatting, and sharing emotes. The ROM and save remain on your SD card.</p><div class="status"><span class="dot"></span><span id="status">Checking server…</span></div></div><img class="hero-logo" src="/logo.png" width="256" height="256" alt="Emerald Online 3DS emerald network emblem"></section><div class="grid"><section class="card"><div class="qr">${qrSvg}</div></section><section class="card" id="install"><h2>Install with FBI</h2><ol><li>Prepare the private ROM and <code>online.cfg</code> on the SD card using the checklist below.</li><li>Open FBI on the 3DS.</li><li>Choose <b>Remote Install</b>, then <b>Scan QR Code</b>.</li><li>Scan the code and confirm installation.</li></ol><a class="button" href="/emerald-online-3ds.cia">Download CIA</a><a class="button" href="/community">Open community</a><a class="button" href="/status">View live status</a><p><code>${ciaUrl}</code></p><p><a href="/emerald-online-3ds.3dsx">3DSX</a> · <a href="/source">3DS runtime source (code only)</a> · <a href="/SHA256SUMS">Verify downloads</a></p><h3>Game endpoint</h3><p class="endpoint"><code>${gamePublicUrl}</code></p><p class="warning"><b>Current beta boundary:</b> presence, roster, same-map chat, emotes, pairing, and forums are available. Native RFU/Union Room battles and trades remain a private opt-in experiment and are not claimed working.</p></section></div><section class="showcase" id="prepare"><div class="eyebrow">Required before launch</div><h2>Prepare the SD card</h2><div class="info-grid"><div><h3>Private files</h3><p>The runtime supports the unmodified Pokémon Emerald US cartridge revision with game code <code>BPEE</code>, revision 0, and SHA-256 <code>a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af</code>. Validate it locally; never upload it.</p><pre>sd:/3ds/emerald-online-3ds/<br>  emerald.gba<br>  online.cfg<br>  emerald-online-3ds.3dsx  (3DSX only)</pre><p>Preserve <code>emerald.sav</code>, <code>identity.cfg</code>, <code>stats.cfg</code>, <code>avatars.t3x</code>, and <code>link-backups/</code> when updating. Back up the whole folder first.</p></div><div><h3>Normal public configuration</h3><pre>server=live.emeraldonline3ds.com<br>port=443<br>transport=wss<br>path=/game<br>name=Trainer</pre><p>Do not put credentials or recovery codes in <code>online.cfg</code>. The app creates <code>identity.cfg</code> separately on first connection. See the <a href="/community?guide=install-on-3ds">full 3DS installation guide</a> for CIA and 3DSX update details.</p></div></div></section><section class="showcase"><div class="eyebrow">What the service sees</div><h2>Privacy at a glance</h2><div class="info-grid"><div><h3>Online presence</h3><p>While connected, the service receives an anonymous device identity plus your display name and current presence state. Authenticated online players can see your display name, current map, and tile coordinates in the global roster. Gameplay snapshots, chat, and emotes remain map-local.</p></div><div><h3>Data kept on your device</h3><p>The service never receives your ROM, save file, Trainer ID, Pokémon, moves, party, or inventory. Routine map chat is relayed without server storage. Save-derived leaderboard fields are off until you explicitly enable them.</p><p><a href="/community?guide=privacy-and-data">Read the privacy and data-control guide</a>.</p></div></div></section><section class="showcase"><div class="eyebrow">Authentic project captures</div><h2>See the interface before installing</h2><div class="shots"><figure><img src="/release-media/0.8.4-online-users.png" alt="Read-only global Online Users list with maps and tile coordinates on the 3DS lower screen" loading="lazy"><figcaption>Online Users is a touch-paged global roster. Names stay on the left; each trainer's current map and tile coordinates are aligned on the right.</figcaption></figure><figure><img src="/release-media/0.8.4-map-chat.png" alt="Timestamped current-map chat list on the 3DS lower screen" loading="lazy"><figcaption>Map Chat keeps a session-only, current-map list with sender, UTC timestamp, message, paging, and a Compose control.</figcaption></figure><figure><img src="/release-media/community-forums.png" alt="Emerald Online 3DS community forum in a desktop browser" loading="lazy"><figcaption>Public releases, installation help, live service status, confirmed issues, and paired-player boards.</figcaption></figure><figure><img src="/release-media/online-dashboard.png" alt="Emerald Online lower-screen dashboard running in Azahar" loading="lazy"><figcaption>The original lower-screen online dashboard in Azahar. ROM-derived gameplay pixels and private save information are not used as website media.</figcaption></figure></div></section><footer class="site-footer"><h2>Independent community project</h2><p>Emerald Online 3DS is an unofficial, fan-made homebrew beta. It is not affiliated with, endorsed by, or sponsored by Nintendo, The Pokémon Company, or Game Freak. Nintendo 3DS, Pokémon, Pokémon Emerald, and related names, characters, artwork, and trademarks belong to their respective owners.</p><p class="legal">This project does not host, provide, sell, or distribute ROMs, game files, encryption keys, copyrighted artwork, or copyrighted audio. You must supply your own legally obtained cartridge dump and comply with the laws that apply to you. Only the original homebrew runtime and its required corresponding source are distributed here.</p><p class="legal">Beta software may contain defects or cause data loss. Back up your save before use. Your ROM, save, party, and inventory remain on your device; never share <code>identity.cfg</code> or a recovery code.</p><nav aria-label="Project links"><a href="#install">Install</a><a href="/community">Community &amp; defects</a><a href="/community?guide=privacy-and-data">Privacy &amp; data controls</a><a href="/status">Live status</a><a href="/source">3DS runtime source</a><a href="/SHA256SUMS">Verify downloads</a></nav></footer></main><script>
fetch('/api/status',{cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok||!data.ok)throw new Error();document.body.classList.add('ready');document.getElementById('status').textContent='Online · '+data.authenticated+' trainer'+(data.authenticated===1?'':'s')+' connected';}).catch(()=>{document.getElementById('status').textContent='Server temporarily unavailable';});
</script></body></html>`;

page = page
  .replace(
    'presence, roster, same-map chat, emotes, pairing, and forums are available.',
    'presence, roster, switchable map/global chat, emotes, pairing, and forums are available.'
  )
  .replace(
    'Gameplay snapshots, chat, and emotes remain map-local.',
    'Gameplay snapshots and emotes remain map-local. Chat is session-only: Map Chat stays map-local, while Global Chat is visible to every authenticated online trainer.'
  )
  .replace(
    'Routine map chat is relayed without server storage.',
    'Routine Map and Global Chat are relayed without server storage.'
  )
  .replace(
    'Map Chat keeps a session-only, current-map list with sender, UTC timestamp, message, paging, and a Compose control.',
    'Chat switches between session-only Map and Global views, uses larger rows, and opens a full message when tapped.'
  )
  .replace(
    'Native RFU/Union Room battles and trades remain a private opt-in experiment and are not claimed working.',
    'A complete two-Azahar RFU/Union Room trade now passes, including the native animation, save, restart, and party exchange. Physical 3DS trading, battles, interruption recovery, audio, and hardware performance remain private acceptance work.'
  )
  .replace(
    '<div class="shots">',
    '<div class="shots"><figure><img src="/release-media/0.8.8-map-global-chat.png" alt="Emerald Online 3DS Chat page with Map Chat and Global Chat scope buttons, large message text, and tap-to-read guidance" loading="lazy"><figcaption>Version 0.8.8 switches between Map and Global Chat, shows three larger message rows per page, and opens the full text when a row is tapped.</figcaption></figure><figure><img src="/release-media/0.8.7-trading-board.png" alt="CODEX offering Torchic for a Water-type Pokemon on Emerald\'s native Union Room Trading Board" loading="lazy"><figcaption>Two isolated Azahar clients found the same native Trading Board offer through the public relay.</figcaption></figure><figure><img src="/release-media/0.8.7-union-room-trade.png" alt="Native Pokemon Emerald Union Room trade animation sending Marill" loading="lazy"><figcaption>The v0.8.7 acceptance run completed Emerald\'s native trade animation, automatic save, restart, and exchanged-party verification.</figcaption></figure>'
  )
  .replace(
    'ROM-derived gameplay pixels and private save information are not used as website media.',
    'The project publishes limited test screenshots for documentation, never ROM or save files.'
  );

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;
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
  if (pathname === '/health' || pathname === '/api/status') {
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
  if (pathname === '/api/public-status') {
    const result = await readPublicStatus();
    res.writeHead(result.ok ? 200 : 503, securityHeaders({ 'content-type': 'application/json', 'cache-control': 'no-store' }));
    res.end(JSON.stringify(result));
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
