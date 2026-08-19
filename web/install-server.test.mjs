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
  const releaseVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
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

  const statusApi = await fetch(`${base}/api/status`);
  assert.equal(statusApi.status, 200);
  const statusBody = await statusApi.json();
  assert.equal(typeof statusBody.registered, 'number');

  const metrics = await fetch(`http://127.0.0.1:${statusPort}/metrics`);
  assert.equal(metrics.status, 200);
  assert.match(metrics.headers.get('content-type'), /text\/plain/);
  assert.match(await metrics.text(), /emerald_online_connection_capacity 64/);

  const page = await fetch(base);
  const pageBody = await page.text();
  assert.match(pageBody, /Remote Install/);
  assert.match(pageBody, /registered/);
  assert.match(pageBody, /live\.emeraldonline3ds\.com/);
  assert.match(pageBody, new RegExp(`Public multiplayer presence service · v${releaseVersion.replaceAll('.', '\\.')}`));
  assert.match(pageBody, /\.button\{display:inline-block;margin:10px 10px 0 0/);
  assert.match(pageBody, /3DS runtime source \(code only\)/);
  assert.match(pageBody, /Verify downloads/);
  assert.doesNotMatch(pageBody, /Corresponding source|SHA-256 checksums/);
  assert.match(pageBody, /not affiliated with, endorsed by, or sponsored by Nintendo/);
  assert.match(pageBody, /does not host, provide, sell, or distribute ROMs/);
  assert.match(pageBody, /Back up your save before use/);
  assert.match(pageBody, /a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af/);
  assert.match(pageBody, /server=live\.emeraldonline3ds\.com/);
  assert.match(pageBody, /complete two-Azahar RFU\/Union Room trade now passes/);
  assert.match(pageBody, /0\.8\.7-trading-board\.png/);
  assert.match(pageBody, /0\.8\.7-union-room-trade\.png/);
  assert.match(pageBody, /Authenticated online players can see your display name, current map, and tile coordinates/);
  assert.match(pageBody, /community\?guide=privacy-and-data/);
  assert.match(pageBody, /src="\/logo\.png"/);
  assert.match(pageBody, /release-media\/community-forums\.png/);
  assert.match(pageBody, /release-media\/online-dashboard\.png/);
  assert.match(pageBody, /release-media\/0\.8\.4-online-users\.png/);
  assert.match(pageBody, /release-media\/0\.8\.4-map-chat\.png/);
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

  for (const image of ['community-forums.png', 'online-dashboard.png']) {
    const screenshot = await fetch(`${base}/release-media/${image}`);
    assert.equal(screenshot.status, 200);
    assert.equal(screenshot.headers.get('content-type'), 'image/png');
    assert.ok(Number(screenshot.headers.get('content-length')) > 50000);
  }
  for (const image of ['0.8.4-online-users.png', '0.8.4-map-chat.png', '0.8.8-map-global-chat.png']) {
    const screenshot = await fetch(`${base}/release-media/${image}`);
    assert.equal(screenshot.status, 200);
    assert.equal(screenshot.headers.get('content-type'), 'image/png');
    assert.ok(Number(screenshot.headers.get('content-length')) > 10000);
  }

  const publicStatus = await fetch(`${base}/api/public-status`);
  assert.equal(publicStatus.status, 200);
  const publicStatusBody = await publicStatus.json();
  assert.equal(publicStatusBody.ok, true);
  assert.equal(publicStatusBody.release, releaseVersion);
  assert.deepEqual(publicStatusBody.services.map(service => service.status), ['operational', 'operational', 'operational', 'operational']);
  assert.equal(publicStatusBody.services.find(service => service.id === 'multiplayer').url, 'wss://live.emeraldonline3ds.com/game');
  assert.doesNotMatch(JSON.stringify(publicStatusBody), /192\.168\.|\.svc\.cluster\.local|postgres/i);

  const servicePage = await fetch(`${base}/status`);
  const servicePageBody = await servicePage.text();
  assert.equal(servicePage.status, 200);
  assert.match(servicePageBody, /Service status/);
  assert.match(servicePageBody, /Operational/);
  assert.match(servicePageBody, /\/api\/public-status/);

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

  const unistore = await fetch(`${base}/emerald-online-3ds.unistore`);
  assert.equal(unistore.status, 200);
  assert.equal(unistore.headers.get('content-type'), 'application/json');
  const unistoreBody = await unistore.json();
  assert.equal(unistoreBody.storeInfo.title, 'Emerald Online 3DS');
  assert.equal(unistoreBody.storeInfo.file, 'emerald-online-3ds.unistore');
  assert.equal(unistoreBody.storeContent.length, 1);
  const unistoreApp = unistoreBody.storeContent[0];
  assert.equal(unistoreApp.info.version, `v${releaseVersion}`);
  const unistore3dsx = unistoreApp[`Emerald Online 3DS v${releaseVersion} (3DSX)`];
  const unistoreCia = unistoreApp[`Emerald Online 3DS v${releaseVersion} (CIA)`];
  assert.ok(Array.isArray(unistore3dsx));
  assert.ok(Array.isArray(unistoreCia));
  assert.equal(unistore3dsx[0].type, 'downloadFile');
  assert.equal(unistore3dsx[0].output, '%3DSX%/emerald-online-3ds.3dsx');
  assert.equal(unistore3dsx[0].file, 'https://emeraldonline3ds.com/emerald-online-3ds.3dsx');
  assert.match(unistore3dsx[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(unistoreCia[0].type, 'downloadFile');
  assert.equal(unistoreCia[0].output, 'sdmc:/emerald-online-3ds.cia');
  assert.equal(unistoreCia[1].type, 'installCia');
  assert.equal(unistoreCia[1].file, '/emerald-online-3ds.cia');
  assert.equal(unistoreCia[2].type, 'deleteFile');
  assert.equal(unistoreCia[2].file, 'sdmc:/emerald-online-3ds.cia');

  const release = await fetch(`${base}/api/release`);
  assert.equal(release.status, 200);
  const releaseBody = await release.json();
  assert.equal(releaseBody.version, releaseVersion);
  assert.equal(releaseBody.cia_url, 'https://emeraldonline3ds.com/emerald-online-3ds.cia');
  assert.equal(releaseBody.threedsx_url, 'https://emeraldonline3ds.com/emerald-online-3ds.3dsx');
  assert.match(releaseBody.sha256_cia, /^[a-f0-9]{64}$/);
  assert.match(releaseBody.sha256_threedsx, /^[a-f0-9]{64}$/);
  assert.equal(releaseBody.release_notes_url, 'https://emeraldonline3ds.com/');

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
