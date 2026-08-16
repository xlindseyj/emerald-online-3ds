import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { startServers } from '../server/src/server.mjs';
import { MemoryIdentityStore } from '../server/src/identity-store.mjs';

const root = path.resolve(import.meta.dirname, '..');
const isWindows = process.platform === 'win32';
const emulator = process.env.AZAHAR_PATH ?? (isWindows
  ? path.join(root, '.tools', 'azahar-2126.0', 'azahar-windows-msvc-2126.0', 'azahar.exe')
  : path.join(root, '.tools', 'azahar', 'azahar-2126.0.AppImage'));
const app = process.env.RUNTIME_3DSX
  ? path.resolve(root, process.env.RUNTIME_3DSX)
  : path.join(root, 'release', 'emerald-online-3ds.3dsx');
const isGpspRuntime = path.basename(app) === 'emerald-online-3ds.3dsx';
const networkMode = process.env.EMULATOR_NETWORK_MODE ?? 'local-tcp';
if (!['local-tcp', 'production-wss'].includes(networkMode)) throw new Error('EMULATOR_NETWORK_MODE must be local-tcp or production-wss');
const productionWss = networkMode === 'production-wss';
const startPage = process.env.EMULATOR_START_PAGE?.toLowerCase();
if (startPage && !['online', 'users', 'chat', 'party', 'bag', 'map', 'stats'].includes(startPage)) {
  throw new Error('EMULATOR_START_PAGE must be online, users, chat, party, bag, map, or stats');
}
const privateRom = path.join(root, 'Pokemon - Emerald Version.gba');
const privateConfig = path.join(root, 'generated', 'sd-card', '3ds', 'emerald-online-3ds', 'online.cfg');
const profile = path.join(root, '.tools', 'azahar-profile');
const virtualSd = isWindows
  ? path.join(process.env.APPDATA, 'Azahar', 'sdmc', '3ds', 'emerald-online-3ds')
  : path.join(profile, 'data', 'azahar-emu', 'sdmc', '3ds', 'emerald-online-3ds');
for (const required of [emulator, app, privateRom, privateConfig]) if (!fs.existsSync(required)) throw new Error(`missing ${required}`);
fs.mkdirSync(virtualSd, { recursive: true });
fs.copyFileSync(privateRom, path.join(virtualSd, 'emerald.gba'));
const privateAvatar = path.join(root, 'generated', 'sd-card', '3ds', 'emerald-online-3ds', 'avatars.t3x');
if (fs.existsSync(privateAvatar)) fs.copyFileSync(privateAvatar, path.join(virtualSd, 'avatars.t3x'));
// Azahar does not implement the Luma kernel backdoor used by the hardware
// dynarec, so all emulator modes use the interpreter. The default local mode
// is deterministic; production-wss exercises the exact mbedTLS/Cloudflare path.
fs.writeFileSync(path.join(virtualSd, 'online.cfg'), [
  productionWss ? 'server=live.emeraldonline3ds.com' : 'server=127.0.0.1',
  productionWss ? 'port=443' : 'port=3210',
  productionWss ? 'transport=wss' : 'transport=tcp', 'path=/game',
  'name=May', 'dynarec=disabled',
  ...(startPage ? [`page=${startPage}`] : []), ''
].join('\n'));
const virtualIdentity = path.join(virtualSd, 'identity.cfg');
const virtualLog = path.join(virtualSd, 'gpsp-debug.log');
fs.rmSync(virtualIdentity, { force: true });
fs.rmSync(virtualLog, { force: true });

const local = productionWss ? null : await startServers({ identityStore: new MemoryIdentityStore() });
let displayProcess;
let displayName = process.env.DISPLAY;
if (!isWindows && !displayName) {
  const xvfb = path.join(root, '.tools', 'xvfb', 'root', 'usr', 'bin', 'Xvfb');
  if (!fs.existsSync(xvfb)) throw new Error(`missing local Xvfb: ${xvfb}`);
  for (let number = 99; number >= 90; --number) {
    const candidate = `:${number}`;
    const process = spawn(xvfb, [candidate, '-screen', '0', '1280x720x24', '-nolisten', 'tcp', '-ac'], { stdio: 'ignore' });
    await new Promise(resolve => setTimeout(resolve, 250));
    if (process.exitCode === null) { displayProcess = process; displayName = candidate; break; }
  }
  if (!displayProcess) throw new Error('could not start Xvfb on displays :90 through :99');
}
const emulatorArgs = isWindows ? [app] : ['--appimage-extract-and-run', app];
const isolateDesktopBus = !isWindows && process.env.AZAHAR_ISOLATE_DBUS !== 'false';
const desktopBusRunner = process.env.DBUS_RUN_SESSION_PATH ?? '/usr/bin/dbus-run-session';
if (isolateDesktopBus && !fs.existsSync(desktopBusRunner)) throw new Error(`missing D-Bus session runner: ${desktopBusRunner}`);
const childCommand = isolateDesktopBus ? desktopBusRunner : emulator;
const childArgs = isolateDesktopBus ? ['--', emulator, ...emulatorArgs] : emulatorArgs;
const child = spawn(childCommand, childArgs, {
  windowsHide: true,
  detached: !isWindows,
  stdio: 'ignore',
  env: isWindows ? process.env : {
    ...process.env,
    DISPLAY: displayName,
    XDG_CONFIG_HOME: path.join(profile, 'config'),
    XDG_DATA_HOME: path.join(profile, 'data'),
    XDG_CACHE_HOME: path.join(profile, 'cache')
  }
});
const stopEmulator = async () => {
  if (!child.pid) return;
  if (isWindows) {
    child.kill();
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch { child.kill(); }
  await new Promise(resolve => setTimeout(resolve, 750));
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch {}
};
try {
  if (productionWss) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline && !fs.existsSync(virtualIdentity)) await new Promise(resolve => setTimeout(resolve, 500));
    const diagnostic = fs.existsSync(virtualLog) ? fs.readFileSync(virtualLog, 'utf8') : '';
    if (!fs.existsSync(virtualIdentity)) throw new Error(`runtime did not enroll through production WSS\n${diagnostic.slice(-2000)}`);
    const identityConfig = fs.readFileSync(virtualIdentity, 'utf8');
    const identity = identityConfig.match(/^id=([0-9a-f-]{36})$/m)?.[1];
    const token = identityConfig.match(/^token=([0-9a-f]{64})$/m)?.[1];
    if (!identity || !token) throw new Error('runtime persisted an invalid production identity credential');
    await new Promise((resolve, reject) => {
      const socket = new WebSocket('wss://live.emeraldonline3ds.com/game');
      const timeout = setTimeout(() => { socket.terminate(); reject(new Error('production identity cleanup timeout')); }, 8000);
      socket.on('open', () => socket.send(`${JSON.stringify({ type: 'hello', version: 2, name: 'Azahar', identity, token, avatar: 'girl' })}\n`));
      socket.on('message', data => {
        for (const line of data.toString().split('\n').filter(Boolean)) {
          const message = JSON.parse(line);
          if (message.type === 'welcome') socket.send('{"type":"delete_identity","confirm":"DELETE"}\n');
          if (message.type === 'identity_deleted') { clearTimeout(timeout); socket.close(); resolve(); }
        }
      });
      socket.on('error', reject);
    });
    console.log(JSON.stringify({ ok: true, engine: 'gpSP-interpreter-smoke', network: 'production-wss', endpoint: 'wss://live.emeraldonline3ds.com/game', serverIssuedIdentityPersisted: true, syntheticIdentityDeleted: true, diagnostic: diagnostic.trim().split('\n').slice(-3) }));
    process.exitCode = 0;
  } else {
  const deadline = Date.now() + 15000;
  let connections = 0;
  let runtimeClient;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    connections = local.presence.clients.size;
    runtimeClient = [...local.presence.clients.values()][0];
    if (runtimeClient?.name) break;
  }
  if (!connections) throw new Error('runtime did not connect to the presence server within 15 seconds');
  if (!runtimeClient?.name) throw new Error('runtime connected but did not complete the hello handshake within 15 seconds');
  if (runtimeClient.name !== 'May') throw new Error(`runtime ignored configured trainer name (got ${runtimeClient.name})`);
  const identityDeadline = Date.now() + 3000;
  while (!fs.existsSync(virtualIdentity) && Date.now() < identityDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  if (!fs.existsSync(virtualIdentity)) throw new Error('runtime enrolled but did not persist its server-issued identity');
  const identityConfig = fs.readFileSync(virtualIdentity, 'utf8');
  if (!/^id=[0-9a-f-]{36}$/m.test(identityConfig) || !/^token=[0-9a-f]{64}$/m.test(identityConfig)) throw new Error('runtime persisted an invalid identity credential');

  const seenBeforeKeepalive = runtimeClient.seen;
  await new Promise(resolve => setTimeout(resolve, 11000));
  if (runtimeClient.seen <= seenBeforeKeepalive) throw new Error('runtime did not send its stationary-player keepalive');

  const firstId = runtimeClient.id;
  runtimeClient.socket.destroy();
  const reconnectDeadline = Date.now() + 12000;
  runtimeClient = undefined;
  while (Date.now() < reconnectDeadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    runtimeClient = [...local.presence.clients.values()].find(client => client.name === 'May');
    if (runtimeClient?.name && (isGpspRuntime || runtimeClient.state)) break;
  }
  if (!runtimeClient?.name || (!isGpspRuntime && !runtimeClient.state)) throw new Error('runtime did not reconnect after a forced disconnect');
  if (runtimeClient.id !== firstId) throw new Error('runtime received a different public trainer ID after reconnect');
  connections = local.presence.clients.size;
  runtimeClient.socket.write(`${JSON.stringify({ type: 'snapshot', map: '0-0', players: [
    { id: 'smoke-peer', name: 'Brendan', map: '0-0', x: 1, y: 1, facing: 'down' }
  ] })}\n`);
  runtimeClient.socket.write(`${JSON.stringify({ type: 'chat', id: 'smoke-peer', name: 'Brendan', map: '0-0', text: 'Azahar chat smoke test' })}\n`);
  for (const emote of ['wave', 'battle', 'trade', 'gg']) {
    runtimeClient.socket.write(`${JSON.stringify({ type: 'emote', id: 'smoke-peer', name: 'Brendan', map: '0-0', emote })}\n`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  runtimeClient.socket.write(`${JSON.stringify({ type: 'snapshot', map: '0-0', players: [
    { id: 'smoke-peer', name: 'Brendan', map: '0-0', x: 2, y: 1, facing: 'right' }
  ] })}\n`);
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (child.exitCode !== null) throw new Error(`runtime exited after snapshot injection (${child.exitCode})`);
  console.log(JSON.stringify({ ok: true, engine: isGpspRuntime ? 'gpSP-interpreter-smoke' : 'mGBA', emulatorPid: child.pid, connections, trainerName: runtimeClient.name, protocol: 2, serverIssuedIdentityPersisted: true, stableReconnectIdentity: true, stationaryKeepalive: true, automaticReconnect: true, stateRepublished: Boolean(runtimeClient.state), movementSnapshotsInjected: 2, chatInjected: true, emotesInjected: 4 }));
  }
} finally {
  await stopEmulator();
  if (displayProcess) displayProcess.kill();
  if (local) {
    await new Promise(resolve => local.presence.server.close(resolve));
    await new Promise(resolve => local.health.close(resolve));
  }
}
