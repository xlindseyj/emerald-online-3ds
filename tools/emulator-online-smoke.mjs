import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { startServers } from '../server/src/server.mjs';

const root = path.resolve(import.meta.dirname, '..');
const isWindows = process.platform === 'win32';
const emulator = process.env.AZAHAR_PATH ?? (isWindows
  ? path.join(root, '.tools', 'azahar-2126.0', 'azahar-windows-msvc-2126.0', 'azahar.exe')
  : path.join(root, '.tools', 'azahar', 'azahar-2126.0.AppImage'));
const app = process.env.RUNTIME_3DSX
  ? path.resolve(root, process.env.RUNTIME_3DSX)
  : path.join(root, 'release', 'emerald-online-3ds.3dsx');
const isGpspRuntime = path.basename(app) === 'emerald-online-3ds.3dsx';
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
const configuredSession = fs.readFileSync(privateConfig, 'utf8').match(/^session=([0-9a-f]{32})$/m)?.[1];
if (!configuredSession) throw new Error('generated online.cfg has no valid stable session token');
// Keep emulator validation local and deterministic. Azahar does not implement
// the Luma kernel backdoor used by the hardware dynarec, so use the interpreter.
fs.writeFileSync(path.join(virtualSd, 'online.cfg'), [
  'server=127.0.0.1', 'port=3210', 'transport=tcp', 'path=/game',
  'name=May', `session=${configuredSession}`, 'dynarec=disabled', ''
].join('\n'));

const { presence, health } = await startServers();
let display;
if (!isWindows && !process.env.DISPLAY) {
  const xvfb = path.join(root, '.tools', 'xvfb', 'root', 'usr', 'bin', 'Xvfb');
  if (!fs.existsSync(xvfb)) throw new Error(`missing local Xvfb: ${xvfb}`);
  display = spawn(xvfb, [':99', '-screen', '0', '1280x720x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
  await new Promise(resolve => setTimeout(resolve, 500));
}
const emulatorArgs = isWindows ? [app] : ['--appimage-extract-and-run', app];
const child = spawn(emulator, emulatorArgs, {
  windowsHide: true,
  stdio: 'ignore',
  env: isWindows ? process.env : {
    ...process.env,
    DISPLAY: process.env.DISPLAY ?? ':99',
    XDG_CONFIG_HOME: path.join(profile, 'config'),
    XDG_DATA_HOME: path.join(profile, 'data'),
    XDG_CACHE_HOME: path.join(profile, 'cache')
  }
});
try {
  const deadline = Date.now() + 15000;
  let connections = 0;
  let runtimeClient;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    connections = presence.clients.size;
    runtimeClient = [...presence.clients.values()][0];
    if (runtimeClient?.name) break;
  }
  if (!connections) throw new Error('runtime did not connect to the presence server within 15 seconds');
  if (!runtimeClient?.name) throw new Error('runtime connected but did not complete the hello handshake within 15 seconds');
  if (runtimeClient.name !== 'May') throw new Error(`runtime ignored configured trainer name (got ${runtimeClient.name})`);

  const seenBeforeKeepalive = runtimeClient.seen;
  await new Promise(resolve => setTimeout(resolve, 11000));
  if (runtimeClient.seen <= seenBeforeKeepalive) throw new Error('runtime did not send its stationary-player keepalive');

  const firstId = runtimeClient.id;
  runtimeClient.socket.destroy();
  const reconnectDeadline = Date.now() + 12000;
  runtimeClient = undefined;
  while (Date.now() < reconnectDeadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    runtimeClient = [...presence.clients.values()].find(client => client.name === 'May');
    if (runtimeClient?.name && (isGpspRuntime || runtimeClient.state)) break;
  }
  if (!runtimeClient?.name || (!isGpspRuntime && !runtimeClient.state)) throw new Error('runtime did not reconnect after a forced disconnect');
  if (runtimeClient.id !== firstId) throw new Error('runtime received a different public trainer ID after reconnect');
  connections = presence.clients.size;
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
  console.log(JSON.stringify({ ok: true, engine: isGpspRuntime ? 'gpSP-interpreter-smoke' : 'mGBA', emulatorPid: child.pid, connections, trainerName: runtimeClient.name, stableReconnectIdentity: true, stationaryKeepalive: true, automaticReconnect: true, stateRepublished: Boolean(runtimeClient.state), movementSnapshotsInjected: 2, chatInjected: true, emotesInjected: 4 }));
} finally {
  child.kill();
  if (display) display.kill();
  await new Promise(resolve => presence.server.close(resolve));
  await new Promise(resolve => health.close(resolve));
}
