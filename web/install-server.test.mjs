import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

function findDesktopLinuxDownload(dir, releaseVersion) {
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  const exactCandidates = [
    `EmeraldOnline3DS-Setup-${releaseVersion}.AppImage`,
    `EmeraldOnline3DS-Setup-${releaseVersion}.appimage`,
    `EmeraldOnline3DS-${releaseVersion}.AppImage`,
    `EmeraldOnline3DS-${releaseVersion}.appimage`,
    `Emerald Online 3DS Setup ${releaseVersion}.AppImage`,
    `Emerald Online 3DS Setup ${releaseVersion}.appimage`
  ];
  const linuxArtifacts = entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => !name.toLowerCase().endsWith('.blockmap'))
    .filter(name => {
      if (!name.includes(releaseVersion)) return false;
      return name.toLowerCase().match(/\.(appimage|deb|rpm|tar\.gz|zip)$/) !== null;
    });
  return exactCandidates.find(name => linuxArtifacts.includes(name)) ?? linuxArtifacts[0] ?? null;
}

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
  const desktopFile = `EmeraldOnline3DS-Setup-${releaseVersion}.exe`;
  const hasDesktopDownload = fs.existsSync(path.join(root, 'desktop', 'dist', desktopFile));
  const desktopLinuxFile = findDesktopLinuxDownload(path.join(root, 'desktop', 'dist'), releaseVersion);
  const hasDesktopLinuxDownload = Boolean(desktopLinuxFile);
  const iosFixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-ios-web-test-'));
  const iosFixturePath = path.join(iosFixtureDirectory, 'emerald-online-3ds-ios.ipa');
  const iosFixture = Buffer.from('synthetic signed IPA fixture');
  fs.writeFileSync(iosFixturePath, iosFixture);
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
      GAME_PUBLIC_URL: 'wss://live.emeraldonline3ds.com/game',
      IOS_IPA_PATH: iosFixturePath
    }
  });
  t.after(() => {
    web.kill();
    presence.kill();
    fs.rmSync(iosFixtureDirectory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${installPort}`;
  const health = await waitFor(`${base}/health`);
  const healthBody = await health.json();
  assert.equal(healthBody.ciaUrl, 'https://emeraldonline3ds.com/emerald-online-3ds.cia');
  assert.equal(healthBody.gameUrl, 'wss://live.emeraldonline3ds.com/game');

  const statusApi = await fetch(`${base}/api/status`);
  assert.equal(statusApi.status, 200);
  const statusBody = await statusApi.json();
  assert.equal(typeof statusBody.registered, 'number');
  assert.equal(typeof statusBody.peak24h, 'number');

  const metrics = await fetch(`http://127.0.0.1:${statusPort}/metrics`);
  assert.equal(metrics.status, 200);
  assert.match(metrics.headers.get('content-type'), /text\/plain/);
  assert.match(await metrics.text(), /emerald_online_connection_capacity 64/);

  const page = await fetch(base);
  const pageBody = await page.text();
  assert.match(pageBody, /id="health"/);
  assert.match(pageBody, /copy-cia/);
  assert.match(pageBody, /Copy CIA URL/);
  assert.match(pageBody, /role="tablist"/);
  assert.match(pageBody, /data-install-tab="windows"/);
  assert.match(pageBody, /data-install-tab="linux"/);
  assert.match(pageBody, /data-install-tab="ios"/);
  assert.match(pageBody, /data-install-tab="cia"/);
  assert.match(pageBody, /data-install-tab="3dsx"/);
  assert.match(pageBody, /sidestore:\/\/source\?url=https%3A%2F%2Femeraldonline3ds\.com%2Fsidecommunity\.json/);
  assert.match(pageBody, /href="\/download\/ios"/);
  if (hasDesktopLinuxDownload) {
    assert.match(pageBody, /href="\/download\/desktop-linux"/);
  }
  assert.match(pageBody, /class="skip-link"/);
  assert.match(pageBody, /<meta property="og:title" content="Emerald Online 3DS">/);
  assert.match(pageBody, /live\.emeraldonline3ds\.com/);
  assert.match(pageBody, new RegExp(`Public multiplayer beta · v${releaseVersion.replaceAll('.', '\\.')}`));
  assert.match(pageBody, /3DS runtime source/);
  assert.match(pageBody, /Verify downloads/);
  assert.doesNotMatch(pageBody, /Corresponding source|SHA-256 checksums/);
  assert.match(pageBody, /not affiliated with, endorsed by, or sponsored by Nintendo/);
  assert.match(pageBody, /does not host, sell, or distribute ROMs/);
  assert.match(pageBody, /Back up your save before testing/);
  assert.match(pageBody, /a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af/);
  assert.match(pageBody, /server=live\.emeraldonline3ds\.com/);
  assert.match(pageBody, /complete two-Azahar Union Room trade passes/);
  assert.match(pageBody, /0\.8\.7-trading-board\.png/);
  assert.match(pageBody, /0\.8\.7-union-room-trade\.png/);
  assert.match(pageBody, /without creating an account/);
  assert.match(pageBody, /community\?guide=privacy-and-data/);
  assert.match(pageBody, /src="\/logo\.png"/);
  assert.match(pageBody, /release-media\/community-forums\.png/);
  assert.match(pageBody, /release-media\/0\.8\.4-online-users\.png/);
  assert.match(pageBody, /release-media\/0\.8\.8-map-global-chat\.png/);
  assert.doesNotMatch(pageBody, /Private Organization|Internal Workspace/);
  assert.match(page.headers.get('content-security-policy'), /default-src/);
  assert.match(page.headers.get('content-security-policy'), /style-src 'self'/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);

  const siteCss = await fetch(`${base}/site.css`);
  assert.equal(siteCss.status, 200);
  assert.match(siteCss.headers.get('content-type'), /text\/css/);
  const siteCssBody = await siteCss.text();
  assert.match(siteCssBody, /@media\(max-width:620px\)/);
  assert.match(siteCssBody, /:focus-visible/);
  assert.match(siteCssBody, /prefers-reduced-motion/);

  const communityCss = await fetch(`${base}/community.css`);
  assert.equal(communityCss.status, 200);
  const communityCssBody = await communityCss.text();
  assert.match(communityCssBody, /\.layout>main\{order:1\}/);
  assert.match(communityCssBody, /\.sidebar\[data-open=false\]\{display:none\}/);

  const installScript = await fetch(`${base}/install-page.js`);
  assert.equal(installScript.status, 200);
  const installScriptBody = await installScript.text();
  assert.match(installScriptBody, /ArrowLeft/);
  assert.match(installScriptBody, /registered/);
  assert.match(installScriptBody, /peak24h/);

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

  if (hasDesktopLinuxDownload) {
    const linuxDownload = await fetch(`${base}/download/desktop-linux`);
    assert.equal(linuxDownload.status, 200);
    assert.equal(linuxDownload.headers.get('content-type'), 'application/octet-stream');
    assert.ok(Number(linuxDownload.headers.get('content-length')) > 1000);
  }

  const checksums = await fetch(`${base}/SHA256SUMS`);
  assert.equal(checksums.status, 200);
  const checksumsBody = await checksums.text();
  assert.match(checksumsBody, /emerald-online-3ds\.cia/);
  const checksumsHaveLinuxDownload = hasDesktopLinuxDownload && checksumsBody.includes(desktopLinuxFile);
  if (checksumsHaveLinuxDownload) {
    assert.match(checksumsBody, new RegExp(`${desktopLinuxFile.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`));
  }

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
  assert.equal(releaseBody.desktop_url, hasDesktopDownload ? 'https://emeraldonline3ds.com/download/desktop' : null);
  assert.equal(releaseBody.desktop_linux_url, hasDesktopLinuxDownload ? 'https://emeraldonline3ds.com/download/desktop-linux' : null);
  assert.equal(releaseBody.ios_url, 'https://emeraldonline3ds.com/download/ios');
  assert.match(releaseBody.sha256_cia, /^[a-f0-9]{64}$/);
  assert.match(releaseBody.sha256_threedsx, /^[a-f0-9]{64}$/);
  assert.equal(releaseBody.sha256_ios, null);
  if (hasDesktopLinuxDownload) {
    const linuxHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'desktop', 'dist', desktopLinuxFile))).digest('hex');
    if (checksumsHaveLinuxDownload) {
      assert.equal(releaseBody.sha256_desktop_linux, linuxHash);
    } else {
      assert.equal(releaseBody.sha256_desktop_linux, null);
    }
  } else {
    assert.equal(releaseBody.sha256_desktop_linux, null);
  }
  const manifestDesktopHash = checksumsBody.match(new RegExp(`^([a-f0-9]{64})\\s+${desktopFile.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'm'))?.[1] ?? null;
  assert.equal(releaseBody.sha256_desktop, hasDesktopDownload
    ? crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'desktop', 'dist', desktopFile))).digest('hex')
    : manifestDesktopHash);
  assert.equal(releaseBody.release_notes_url, 'https://emeraldonline3ds.com/');

  const sideStore = await fetch(`${base}/sidecommunity.json`);
  assert.equal(sideStore.status, 200);
  assert.match(sideStore.headers.get('content-type'), /^application\/json/);
  const sideStoreBody = await sideStore.json();
  assert.equal(sideStoreBody.name, 'Emerald Online 3DS');
  assert.equal(sideStoreBody.identifier, 'com.emeraldonline3ds.sidestore');
  assert.equal(sideStoreBody.sourceURL, 'https://emeraldonline3ds.com/sidecommunity.json');
  assert.equal(sideStoreBody.apps.length, 1);
  assert.equal(sideStoreBody.apps[0].bundleIdentifier, 'com.emeraldonline3ds.mobile');
  assert.equal(sideStoreBody.apps[0].versions[0].version, releaseVersion);
  assert.equal(sideStoreBody.apps[0].versions[0].downloadURL, 'https://emeraldonline3ds.com/download/ios');
  assert.equal(sideStoreBody.apps[0].versions[0].size, iosFixture.length);
  assert.equal(sideStoreBody.apps[0].versions[0].minOSVersion, '15.0');

  const iosDownload = await fetch(`${base}/download/ios`);
  assert.equal(iosDownload.status, 200);
  assert.equal(iosDownload.headers.get('content-type'), 'application/octet-stream');
  assert.match(iosDownload.headers.get('content-disposition'), /emerald-online-3ds-ios\.ipa/);
  assert.deepEqual(Buffer.from(await iosDownload.arrayBuffer()), iosFixture);

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
