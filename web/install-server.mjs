import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import QRCode from 'qrcode';
import WebSocket, { WebSocketServer } from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ciaPath = path.join(root, 'release', 'emerald-online-3ds.cia');
const threeDsxPath = path.join(root, 'release', 'emerald-online-3ds.3dsx');
const sourceFilename = `emerald-online-3ds-source-${packageInfo.version}.tar.gz`;
const sourcePath = path.join(root, 'release', sourceFilename);
const checksumsPath = path.join(root, 'release', 'SHA256SUMS');
const logoPath = path.join(root, 'assets', 'emerald-online-3ds-web-logo.png');
const iconPath = path.join(root, 'assets', 'emerald-online-3ds-icon.png');
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

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/png" href="/favicon.png">
<meta name="description" content="Install Emerald Online 3DS and check the public presence server status.">
<title>Emerald Online 3DS</title><style>
:root{color-scheme:dark;font-family:ui-rounded,system-ui,sans-serif;background:#061b16;color:#effff8}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 12% 0,#176348,#061b16 52%);padding:32px 16px}main{width:min(980px,100%);margin:auto}.hero,.card{border:1px solid #65d6a255;border-radius:24px;background:#09251fe8;box-shadow:0 24px 80px #0007}.hero{display:grid;grid-template-columns:1fr clamp(112px,22vw,190px);align-items:center;gap:28px;padding:34px;margin-bottom:22px}.hero-copy{min-width:0}.hero-logo{display:block;width:100%;height:auto;border-radius:23%;filter:drop-shadow(0 16px 25px #0008)}.eyebrow{color:#71e6ad;font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:.78rem}h1{font-size:clamp(2.2rem,7vw,4.8rem);line-height:.96;margin:.35em 0 .25em;color:#eafff5}h1 span{color:#6ce0a7}.lede{max-width:680px;color:#bfe9d5;font-size:1.08rem}.status{display:inline-flex;align-items:center;gap:9px;margin-top:12px;padding:8px 12px;border-radius:999px;background:#0e342a;color:#d9ffed}.dot{width:10px;height:10px;border-radius:50%;background:#f3c969;box-shadow:0 0 14px #f3c969}body.ready .dot{background:#58e49b;box-shadow:0 0 14px #58e49b}.grid{display:grid;grid-template-columns:minmax(250px,360px) 1fr;gap:22px}.card{padding:26px}.qr{padding:14px;background:white;border-radius:18px;line-height:0}.qr svg{width:100%;height:auto}code{word-break:break-all;color:#9de9c4}.button{display:inline-block;margin-top:10px;padding:13px 18px;border-radius:11px;background:#51d596;color:#052017;text-decoration:none;font-weight:800}.warning{color:#ffd68a}.endpoint{padding:13px;border-radius:12px;background:#061b16;border:1px solid #4e9f7a55}li{margin:.55em 0}.site-footer{margin-top:26px;padding:24px 4px 8px;border-top:1px solid #65d6a244;color:#acd6c3;font-size:.86rem;line-height:1.55}.site-footer h2{margin:0 0 8px;color:#dfffee;font-size:1rem}.site-footer p{margin:8px 0}.site-footer nav{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:14px}.site-footer a{color:#75e3ae}.legal{color:#91bbaa}@media(max-width:720px){.grid{grid-template-columns:1fr}.hero{grid-template-columns:1fr}.hero-logo{width:118px;grid-row:1;justify-self:start}.hero,.card{padding:22px}body{padding:18px 12px}}
</style></head><body><main><section class="hero"><div class="hero-copy"><div class="eyebrow">Public multiplayer presence service</div><h1>Emerald <span>Online</span> 3DS</h1><p class="lede">Play your own legally obtained Emerald copy on 3DS while seeing trainers on the same map, chatting, and sharing emotes. The ROM and save remain on your SD card.</p><div class="status"><span class="dot"></span><span id="status">Checking server…</span></div></div><img class="hero-logo" src="/logo.png" width="256" height="256" alt="Emerald Online 3DS emerald network emblem"></section><div class="grid"><section class="card"><div class="qr">${qrSvg}</div></section><section class="card" id="install"><h2>Install with FBI</h2><ol><li>Put your own validated ROM and <code>online.cfg</code> on the SD card first.</li><li>Open FBI on the 3DS.</li><li>Choose <b>Remote Install</b>, then <b>Scan QR Code</b>.</li><li>Scan the code and confirm installation.</li></ol><a class="button" href="/emerald-online-3ds.cia">Download CIA</a><p><code>${ciaUrl}</code></p><p><a href="/emerald-online-3ds.3dsx">3DSX</a> · <a href="/source">Corresponding source</a> · <a href="/SHA256SUMS">SHA-256 checksums</a></p><h3>Game endpoint</h3><p class="endpoint"><code>${gamePublicUrl}</code></p><p class="warning"><b>Private ROM required:</b> the CIA contains no Pokémon ROM. Keep <code>emerald.gba</code>, saves, <code>identity.cfg</code>, and the avatar atlas private at <code>sd:/3ds/emerald-online-3ds/</code>.</p></section></div><footer class="site-footer"><h2>Independent community project</h2><p>Emerald Online 3DS is an unofficial, fan-made homebrew beta. It is not affiliated with, endorsed by, or sponsored by Nintendo, The Pokémon Company, or Game Freak. Nintendo 3DS, Pokémon, Pokémon Emerald, and related names, characters, artwork, and trademarks belong to their respective owners.</p><p class="legal">This project does not host, provide, sell, or distribute ROMs, game files, encryption keys, copyrighted artwork, or copyrighted audio. You must supply your own legally obtained cartridge dump and comply with the laws that apply to you. Only the original homebrew runtime and its required corresponding source are distributed here.</p><p class="legal">Beta software may contain defects or cause data loss. Back up your save before use. Your ROM, save, party, and inventory remain on your device; never share <code>identity.cfg</code> or a recovery code.</p><nav aria-label="Project links"><a href="#install">Install</a><a href="/source">Source &amp; license materials</a><a href="/SHA256SUMS">Verify downloads</a><a href="/health">Service health</a></nav></footer></main><script>
fetch('/api/status',{cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok||!data.ok)throw new Error();document.body.classList.add('ready');document.getElementById('status').textContent='Online · '+data.authenticated+' trainer'+(data.authenticated===1?'':'s')+' connected';}).catch(()=>{document.getElementById('status').textContent='Server temporarily unavailable';});
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/') {
    res.writeHead(200, securityHeaders({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }));
    res.end(page);
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
