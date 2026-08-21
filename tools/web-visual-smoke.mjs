import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'generated', 'ui-review');
const installPort = 18880;
const gamePort = 18881;
const healthPort = 18882;
const base = `http://127.0.0.1:${installPort}`;
const candidates = [process.env.CHROMIUM_BIN, '/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
const chromium = candidates.find(candidate => fs.existsSync(candidate));
if (!chromium) throw new Error('Chromium not found. Set CHROMIUM_BIN to run the visual smoke test.');

const localEnvironment = { ...process.env };
for (const name of ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'DATABASE_CA_PATH', 'IDENTITY_PEPPER']) delete localEnvironment[name];
const presence = spawn(process.execPath, ['server/src/server.mjs'], {
  cwd: root,
  stdio: 'ignore',
  env: { ...localEnvironment, GAME_HOST: '127.0.0.1', GAME_PORT: String(gamePort), HEALTH_PORT: String(healthPort) }
});
const website = spawn(process.execPath, ['web/install-server.mjs'], {
  cwd: root,
  stdio: 'ignore',
  env: {
    ...localEnvironment,
    INSTALL_HOST: '127.0.0.1',
    INSTALL_PORT: String(installPort),
    GAME_UPSTREAM_PORT: String(gamePort),
    STATUS_UPSTREAM_PORT: String(healthPort),
    PUBLIC_BASE_URL: base,
    GAME_PUBLIC_URL: `${base.replace('http:', 'ws:')}/game`
  }
});

async function waitForReady() {
  for (let attempt = 0; attempt < 80; ++attempt) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('visual-smoke website did not become ready');
}

const captures = [
  ['home-desktop.png', '1440,1200', '/'],
  ['home-mobile.png', '390,844', '/'],
  ['community-desktop.png', '1440,1200', '/community'],
  ['community-mobile.png', '390,844', '/community']
];

try {
  await waitForReady();
  fs.mkdirSync(output, { recursive: true });
  for (const [filename, viewport, route] of captures) {
    const destination = path.join(output, filename);
    const result = spawnSync(chromium, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--window-size=${viewport}`, `--screenshot=${destination}`, `${base}${route}`], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0 || !fs.statSync(destination, { throwIfNoEntry: false })?.isFile()) throw new Error(`failed to capture ${filename}`);
  }
  console.log(`Responsive UI captures written to ${output}`);
} finally {
  website.kill();
  presence.kill();
}
