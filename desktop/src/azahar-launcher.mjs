import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  getVirtualSdPath as getVirtualSdPathConstant,
  getAzaharPath,
  getRuntime3dsxPath,
  getOnlineCfgPath as getOnlineCfgPathConstant,
  getRomPath,
  getUserDataPath,
  DEFAULTS
} from './constants.mjs';
import { normalizeConfig } from './config-store.mjs';

export function getVirtualSdPath() {
  return getVirtualSdPathConstant();
}

export function getOnlineCfgPath() {
  return getOnlineCfgPathConstant();
}

export function getInstalledRuntimePath() {
  return path.join(getVirtualSdPathConstant(), 'emerald-online-3ds.3dsx');
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function safeChmod(filePath, mode) {
  try {
    fs.chmodSync(filePath, mode);
  } catch (error) {
    if (process.platform === 'win32' && (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EINVAL')) {
      return;
    }
    throw error;
  }
}

export function ensureRuntimeInstalled() {
  const bundled = findRuntime3dsx();
  const installed = getInstalledRuntimePath();
  const statePath = path.join(getUserDataPath(), 'runtime-state.json');
  const bundledHash = sha256(bundled);
  let previousBundledHash = null;
  let runtimePolicyVersion = 0;
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    previousBundledHash = state.bundledHash ?? null;
    runtimePolicyVersion = state.policyVersion ?? 0;
  } catch {}

  // Preserve an in-app runtime update while this desktop package is current,
  // but make a newer desktop package authoritative. Otherwise, once the
  // runtime has updated itself, every later desktop release would keep the old
  // staged file forever (including versions incompatible with the emulator).
  const desktopPackageChanged = Boolean(previousBundledHash && previousBundledHash !== bundledHash);
  // Version 1 wrote the new bundled hash even when it retained an older
  // runtime. Restage once when migrating that state so affected installs heal.
  const shouldInstall = !fs.existsSync(installed) || desktopPackageChanged || runtimePolicyVersion < 2;

  fs.mkdirSync(path.dirname(installed), { recursive: true });
  if (shouldInstall) {
    const temporary = `${installed}.launcher-tmp`;
    fs.copyFileSync(bundled, temporary);
    safeChmod(temporary, 0o700);
    fs.renameSync(temporary, installed);
  }
  fs.writeFileSync(statePath, `${JSON.stringify({ bundledHash, policyVersion: 2 }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return installed;
}

export function writeOnlineConfig(config) {
  const sd = getVirtualSdPathConstant();
  fs.mkdirSync(sd, { recursive: true });

  const normalized = normalizeConfig({ ...DEFAULTS, ...config });

  const lines = [
    `server=${normalized.server}`,
    `port=${normalized.port}`,
    `transport=${normalized.transport}`,
    `path=${normalized.path}`,
    `name=${normalized.name}`,
    `online=${normalized.online ? 'enabled' : 'disabled'}`,
    // Azahar cannot provide the Luma kernel service used by the ARM dynarec.
    'dynarec=disabled',
    `page=${normalized.page}`,
    ''
  ];

  fs.writeFileSync(getOnlineCfgPathConstant(), lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
}

export function setupVirtualSd(romSourcePath) {
  const sd = getVirtualSdPathConstant();
  fs.mkdirSync(sd, { recursive: true });
  const destRom = path.join(sd, 'emerald.gba');
  const temporary = `${destRom}.tmp`;
  fs.copyFileSync(romSourcePath, temporary);
  safeChmod(temporary, 0o600);
  fs.renameSync(temporary, destRom);
}

export function findAzahar() {
  const azahar = getAzaharPath();
  if (!azahar || !fs.existsSync(azahar)) {
    throw new Error('Azahar emulator not found. Set AZAHAR_PATH or bundle azahar.exe in resources/azahar.');
  }
  return azahar;
}

export function findRuntime3dsx() {
  const runtime = getRuntime3dsxPath();
  if (!runtime || !fs.existsSync(runtime)) {
    throw new Error('Runtime 3DSX not found. Build the public runtime first (npm run build:public).');
  }
  return runtime;
}

export function ensureAzaharPortableUserDirectory(azahar) {
  if (process.platform !== 'win32') return;

  const profile = path.join(getUserDataPath(), 'Azahar');
  const portableUser = path.join(path.dirname(azahar), 'user');
  fs.mkdirSync(profile, { recursive: true });

  if (fs.existsSync(portableUser)) {
    let existingTarget;
    try {
      existingTarget = fs.realpathSync(portableUser);
    } catch {
      throw new Error('Azahar portable user directory is inaccessible.');
    }
    if (path.resolve(existingTarget).toLowerCase() !== path.resolve(profile).toLowerCase()) {
      throw new Error('Azahar portable user directory points outside the launcher profile.');
    }
    return;
  }

  // Qt resolves the Windows roaming profile through a shell API, so changing
  // APPDATA in the child environment does not redirect Azahar. Azahar's
  // supported portable `user` directory does, and a junction keeps the actual
  // private data in Electron's userData directory rather than beside the exe.
  fs.symlinkSync(profile, portableUser, 'junction');
}

export function launchAzahar() {
  const azahar = findAzahar();
  const runtime = ensureRuntimeInstalled();
  ensureAzaharPortableUserDirectory(azahar);

  // Azahar on Windows uses %APPDATA%/Azahar for user data. We redirect it to
  // our launcher userData directory so the virtual SD card, config, saves, and
  // identity stay inside the application data folder.
  const child = spawn(azahar, [runtime], {
    cwd: path.dirname(azahar),
    windowsHide: false,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      APPDATA: getUserDataPath()
    }
  });

  return child;
}

export function getLauncherStatus() {
  const azaharPath = getAzaharPath();
  const runtimePath = getRuntime3dsxPath();
  return {
    azaharReady: Boolean(azaharPath && fs.existsSync(azaharPath)),
    runtimeReady: Boolean(runtimePath && fs.existsSync(runtimePath)),
    romPresent: fs.existsSync(getRomPath()),
    platformSupported: process.platform === 'win32' || Boolean(process.env.AZAHAR_PATH),
    dataPath: getVirtualSdPathConstant()
  };
}

export { getRomPath };
