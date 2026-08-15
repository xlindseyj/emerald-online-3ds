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
  const presence = spawn(process.execPath, ['server/src/server.mjs'], {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, GAME_HOST: '127.0.0.1', GAME_PORT: String(gamePort), HEALTH_PORT: String(statusPort) }
  });
  const web = spawn(process.execPath, ['web/install-server.mjs'], {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      INSTALL_HOST: '127.0.0.1',
      INSTALL_PORT: String(installPort),
      GAME_UPSTREAM_PORT: String(gamePort),
      STATUS_UPSTREAM_PORT: String(statusPort),
      PUBLIC_BASE_URL: 'https://pokemon.lws-workspace.com',
      GAME_PUBLIC_URL: 'wss://pokemon-server.lws-workspace.com/game'
    }
  });
  t.after(() => { web.kill(); presence.kill(); });

  const base = `http://127.0.0.1:${installPort}`;
  const health = await waitFor(`${base}/health`);
  const healthBody = await health.json();
  assert.equal(healthBody.ciaUrl, 'https://pokemon.lws-workspace.com/emerald-online-3ds.cia');
  assert.equal(healthBody.gameUrl, 'wss://pokemon-server.lws-workspace.com/game');

  const page = await fetch(base);
  const pageBody = await page.text();
  assert.match(pageBody, /Remote Install/);
  assert.match(pageBody, /pokemon-server\.lws-workspace\.com/);
  assert.match(pageBody, /Corresponding source/);
  assert.match(page.headers.get('content-security-policy'), /default-src/);

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
