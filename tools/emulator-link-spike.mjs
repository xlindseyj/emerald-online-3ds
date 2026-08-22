import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MemoryIdentityStore } from '../server/src/identity-store.mjs';
import { createPresenceServer } from '../server/src/server.mjs';

const root = path.resolve(import.meta.dirname, '..');
const emulator = process.env.AZAHAR_PATH ?? path.join(root, '.tools', 'azahar', 'azahar-2126.0.AppImage');
const app = process.env.RUNTIME_3DSX ? path.resolve(root, process.env.RUNTIME_3DSX) : path.join(root, 'gpsp-runtime', 'emerald-online-3ds.3dsx');
const rom = path.join(root, 'Pokemon - Emerald Version.gba');
const avatar = path.join(root, 'generated', 'sd-card', '3ds', 'emerald-online-3ds', 'avatars.t3x');
const xvfbPath = path.join(root, '.tools', 'xvfb', 'root', 'usr', 'bin', 'Xvfb');
for (const required of [emulator, app, rom, xvfbPath]) if (!fs.existsSync(required)) throw new Error(`missing ${required}`);

const identityStore = new MemoryIdentityStore();
const presence = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, maxConnectionsPerIp: 8, idleMs: 30000 });
await new Promise(resolve => presence.server.listen(0, '127.0.0.1', resolve));
const port = presence.server.address().port;
const room = 'TEST-2345';
const cycles = Number(process.env.LINK_CYCLES ?? 1);
if (!Number.isInteger(cycles) || cycles < 1 || cycles > 4) throw new Error('LINK_CYCLES must be an integer from 1 through 4');
const profiles = ['host', 'guest'].map(role => {
  const profile = path.join(root, '.tools', `azahar-link-${role}`);
  fs.rmSync(profile, { recursive: true, force: true });
  const sd = path.join(profile, 'data', 'azahar-emu', 'sdmc', '3ds', 'emerald-online-3ds');
  fs.mkdirSync(sd, { recursive: true });
  fs.copyFileSync(rom, path.join(sd, 'emerald.gba'));
  if (fs.existsSync(avatar)) fs.copyFileSync(avatar, path.join(sd, 'avatars.t3x'));
  fs.writeFileSync(path.join(sd, 'online.cfg'), [
    'server=127.0.0.1', `port=${port}`, 'transport=tcp', 'path=/game',
    `name=${role === 'host' ? 'May' : 'Brendan'}`, 'dynarec=disabled', `link_room=${room}`, ''
  ].join('\n'));
  return { role, profile, sd, log: path.join(sd, 'gpsp-debug.log'), backupDirectory: path.join(sd, 'link-backups') };
});

let display;
let children = [];
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const launchClients = () => {
  children = profiles.map(item => spawn(emulator, ['--appimage-extract-and-run', app], {
    stdio: 'ignore',
    env: {
      ...process.env,
      DISPLAY: process.env.DISPLAY ?? ':98',
      XDG_CONFIG_HOME: path.join(item.profile, 'config'),
      XDG_DATA_HOME: path.join(item.profile, 'data'),
      XDG_CACHE_HOME: path.join(item.profile, 'cache')
    }
  }));
};
const stopClients = async () => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && children.some(child => child.exitCode === null)) await wait(100);
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  children = [];
};
const awaitCycle = async cycle => {
  const expected = Math.min(cycle, 3), deadline = Date.now() + 35000;
  while (Date.now() < deadline) {
    const ready = profiles.every(item => fs.existsSync(item.log) &&
      fs.readFileSync(item.log, 'utf8').includes('link-started-backup-complete') &&
      fs.existsSync(item.backupDirectory) && fs.readdirSync(item.backupDirectory).filter(name => name.endsWith('.sav')).length === expected);
    if (ready && presence.status().linkPlayers === 2) return;
    if (children.some(child => child.exitCode !== null)) throw new Error(`an Azahar link instance exited during cycle ${cycle}`);
    await wait(500);
  }
  throw new Error(`Azahar link cycle ${cycle} timed out`);
};
try {
  if (!process.env.DISPLAY) {
    display = spawn(xvfbPath, [':98', '-screen', '0', '1600x900x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
    await wait(500);
  }
  for (let cycle = 1; cycle <= cycles; ++cycle) {
    launchClients();
    await awaitCycle(cycle);
    if (cycle < cycles) {
      await stopClients();
      // Model a hard Wi-Fi/process interruption even if the AppImage wrapper
      // leaves an inherited TCP descriptor lingering briefly.
      for (const client of presence.clients.values()) client.socket.destroy();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && presence.status().linkPlayers) await wait(100);
      if (presence.status().linkPlayers) throw new Error(`link room did not drain after cycle ${cycle}`);
    }
  }
  const diagnostics = profiles.map(item => ({
    role: item.role,
    started: fs.existsSync(item.log) && fs.readFileSync(item.log, 'utf8').includes('link-started-backup-complete'),
    backups: fs.existsSync(item.backupDirectory) ? fs.readdirSync(item.backupDirectory).filter(name => name.endsWith('.sav')).length : 0
  }));
  const expectedBackups = Math.min(cycles, 3);
  if (presence.status().linkPlayers !== 2 || diagnostics.some(item => !item.started || item.backups !== expectedBackups))
    throw new Error(`link spike did not start safely: ${JSON.stringify({ status: presence.status(), diagnostics })}`);
  await wait(2000);
  console.log(JSON.stringify({ ok: true, emulator: 'Azahar 2126.0', clients: 2, transport: 'LAN TCP', room,
    coreMode: 'mul_poke', netpacketSessionsStarted: cycles * 2, restartCycles: cycles, saveBackups: diagnostics.map(item => item.backups), newestBackupsRetained: 3,
    cableClubPackets: presence.metrics.linkPackets, limitation: 'Cable Club navigation and completed battle/trade still require interactive and physical testing.' }));
} finally {
  await stopClients();
  if (display?.exitCode === null) display.kill('SIGTERM');
  await new Promise(resolve => presence.server.close(resolve));
  for (const item of profiles) fs.rmSync(item.profile, { recursive: true, force: true });
}
