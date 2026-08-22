import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const APP_NAME = 'Emerald Online 3DS';

export const SUPPORTED_PAGES = [
  'online', 'users', 'chat', 'party', 'bag', 'map', 'stats',
  'quest', 'titles', 'friends', 'guild', 'teleport', 'update'
];

export const DEFAULTS = {
  server: 'live.emeraldonline3ds.com',
  port: 443,
  transport: 'wss',
  path: '/game',
  name: 'Trainer',
  online: true,
  page: 'online'
};

export function getUserDataPath() {
  if (process.env.ELECTRON_USER_DATA_PATH) return process.env.ELECTRON_USER_DATA_PATH;
  return path.join(os.tmpdir(), 'emerald-online-3ds-desktop-test');
}

export function getVirtualSdPath() {
  // Azahar appends its own `Azahar` directory to %APPDATA% on Windows.
  // launchAzahar points APPDATA at our Electron userData directory, keeping the
  // emulator profile and all private game data isolated under this launcher.
  return path.join(getUserDataPath(), 'Azahar', 'sdmc', '3ds', 'emerald-online-3ds');
}

export function getConfigFilePath() {
  return path.join(getUserDataPath(), 'launcher-config.json');
}

function findInPath(name) {
  const paths = (process.env.PATH || '').split(path.delimiter);
  for (const dir of paths) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function commonAzaharPaths() {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  if (isWin) {
    return [
      path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Azahar', 'azahar.exe'),
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Azahar', 'azahar.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Azahar', 'azahar.exe'),
      path.join(home, 'Azahar', 'azahar.exe')
    ];
  }
  return [
    path.join(home, 'Applications', 'Azahar.app', 'Contents', 'MacOS', 'Azahar'),
    path.join('/', 'Applications', 'Azahar.app', 'Contents', 'MacOS', 'Azahar'),
    path.join(home, '.local', 'bin', 'azahar'),
    path.join('/', 'usr', 'bin', 'azahar'),
    path.join('/', 'usr', 'local', 'bin', 'azahar')
  ];
}

export function getAzaharPath() {
  if (process.env.AZAHAR_PATH) return process.env.AZAHAR_PATH;

  const executable = process.platform === 'win32' ? 'azahar.exe' : 'azahar';
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'azahar', executable) : null,
    path.join(sourceRoot, 'resources', 'azahar', executable),
    // Tolerate the official archive's top-level folder for local development.
    path.join(sourceRoot, 'resources', 'azahar', 'azahar-windows-msvc-2126.0', executable)
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const inPath = findInPath(process.platform === 'win32' ? 'azahar.exe' : 'azahar');
  if (inPath) return inPath;

  for (const candidate of commonAzaharPaths()) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0] ?? null;
}

export function getRuntime3dsxPath() {
  if (process.env.EMERALD_RUNTIME_PATH) return process.env.EMERALD_RUNTIME_PATH;

  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'runtime', 'emerald-online-3ds.3dsx') : null,
    path.join(sourceRoot, 'release', 'emerald-online-3ds.3dsx')
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? null;
}

export function getRomPath() {
  return path.join(getVirtualSdPath(), 'emerald.gba');
}

export function getOnlineCfgPath() {
  return path.join(getVirtualSdPath(), 'online.cfg');
}
