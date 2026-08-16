import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
}

test('public page exposes the CIA and bridges WebSocket gameplay to the presence server', async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const installPort = 18080;
  const gamePort = 18210;
  const statusPort = 18211;
  const localEnvironment = { ...process.env };
  for (const name of ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'DATABASE_CA_PATH', 'IDENTITY_PEPPER']) delete localEnvironment[name];
  const presence = spawn(process.execPath, ['server/src/server.mjs'], {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...localEnvironment, GAME_HOST: '127.0.0.1', GAME_PORT: String(gamePort), HEALTH_PORT: String(statusPort) }
  });
  const web = spawn(process.execPath, ['web/install-server.mjs'], {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...localEnvironment,
      INSTALL_HOST: '127.0.0.1',
      INSTALL_PORT: String(installPort),
      GAME_UPSTREAM_PORT: String(gamePort),
      STATUS_UPSTREAM_PORT: String(statusPort),
      PUBLIC_BASE_URL: 'https://emeraldonline3ds.com',
      GAME_PUBLIC_URL: 'wss://live.emeraldonline3ds.com/game'
    }
  });
  t.after(() => { web.kill(); presence.kill(); });

  const base = `http://127.0.0.1:${installPort}`;
  const health = await waitFor(`${base}/health`);
  const healthBody = await health.json();
  assert.equal(healthBody.ciaUrl, 'https://emeraldonline3ds.com/emerald-online-3ds.cia');
  assert.equal(healthBody.gameUrl, 'wss://live.emeraldonline3ds.com/game');

  const page = await fetch(base);
  const pageBody = await page.text();
  assert.match(pageBody, /Remote Install/);
  assert.match(pageBody, /live\.emeraldonline3ds\.com/);
  assert.match(pageBody, /Corresponding source/);
  assert.match(pageBody, /not affiliated with, endorsed by, or sponsored by Nintendo/);
  assert.match(pageBody, /does not host, provide, sell, or distribute ROMs/);
  assert.match(pageBody, /Back up your save before use/);
  assert.match(pageBody, /src="\/logo\.png"/);
  assert.doesNotMatch(pageBody, /Lindsey Web Solutions|LindseyWebSolutions/);
  assert.match(page.headers.get('content-security-policy'), /default-src/);

  const logo = await fetch(`${base}/logo.png`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  assert.ok(Number(logo.headers.get('content-length')) > 10000);

  const favicon = await fetch(`${base}/favicon.png`);
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get('content-type'), 'image/png');

  const qr = await fetch(`${base}/qr.svg`);
  assert.match(qr.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await qr.text(), /<svg/);

  const download = await fetch(`${base}/emerald-online-3ds.cia`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.match(download.headers.get('content-disposition'), /emerald-online-3ds\.cia/);
  const body = Buffer.from(await download.arrayBuffer());
  const disk = fs.readFileSync(path.join(root, 'release', 'emerald-online-3ds.cia'));
  assert.equal(body.length, disk.length);
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), crypto.createHash('sha256').update(disk).digest('hex'));

  const source = await fetch(`${base}/source`);
  assert.equal(source.status, 200);
  assert.equal(source.headers.get('content-type'), 'application/gzip');
  assert.ok(Number(source.headers.get('content-length')) > 100000);

  const checksums = await fetch(`${base}/SHA256SUMS`);
  assert.equal(checksums.status, 200);
  assert.match(await checksums.text(), /emerald-online-3ds\.cia/);

  const welcome = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${installPort}/game`);
    const timeout = setTimeout(() => reject(new Error('WebSocket welcome timeout')), 2000);
    socket.on('open', () => socket.send('{"type":"hello","version":1,"name":"WebSmoke"}\n'));
    socket.on('message', data => {
      const message = JSON.parse(data.toString().trim());
      if (message.type === 'welcome') {
        clearTimeout(timeout);
        socket.close();
        resolve(message);
      }
    });
    socket.on('error', reject);
  });
  assert.equal(welcome.version, 1);
});
