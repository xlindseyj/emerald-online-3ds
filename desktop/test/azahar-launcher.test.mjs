import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  writeOnlineConfig,
  setupVirtualSd,
  getVirtualSdPath,
  getOnlineCfgPath,
  getInstalledRuntimePath,
  ensureRuntimeInstalled,
  ensureAzaharPortableUserDirectory,
  getLauncherStatus
} from '../src/azahar-launcher.mjs';
import { getRomPath } from '../src/constants.mjs';

describe('azahar-launcher', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo3ds-launcher-test-'));
    process.env.ELECTRON_USER_DATA_PATH = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ELECTRON_USER_DATA_PATH;
    delete process.env.AZAHAR_PATH;
    delete process.env.EMERALD_RUNTIME_PATH;
  });

  it('writes production online.cfg by default', () => {
    writeOnlineConfig({});
    const cfg = fs.readFileSync(getOnlineCfgPath(), 'utf8');
    assert.match(cfg, /server=live\.emeraldonline3ds\.com/);
    assert.match(cfg, /port=443/);
    assert.match(cfg, /transport=wss/);
    assert.match(cfg, /path=\/game/);
    assert.match(cfg, /name=Trainer/);
    assert.match(cfg, /online=enabled/);
    assert.match(cfg, /dynarec=disabled/);
    assert.match(cfg, /page=online/);
  });

  it('writes a real offline flag without replacing the configured endpoint', () => {
    writeOnlineConfig({ online: false, name: 'May', port: 3210 });
    const cfg = fs.readFileSync(getOnlineCfgPath(), 'utf8');
    assert.match(cfg, /server=live\.emeraldonline3ds\.com/);
    assert.match(cfg, /port=3210/);
    assert.match(cfg, /transport=wss/);
    assert.match(cfg, /name=May/);
    assert.match(cfg, /online=disabled/);
  });

  it('copies the ROM into the virtual SD directory', () => {
    const romSrc = path.join(tmpDir, 'emerald.gba');
    fs.writeFileSync(romSrc, 'synthetic-rom-content');
    setupVirtualSd(romSrc);
    assert.ok(fs.existsSync(getRomPath()));
    assert.equal(fs.readFileSync(getRomPath(), 'utf8'), 'synthetic-rom-content');
  });

  it('creates the virtual SD directory', () => {
    const dummy = path.join(tmpDir, 'dummy.gba');
    fs.writeFileSync(dummy, 'dummy');
    setupVirtualSd(dummy);
    assert.ok(fs.existsSync(getVirtualSdPath()));
    assert.equal(getVirtualSdPath(), path.join(tmpDir, 'Azahar', 'sdmc', '3ds', 'emerald-online-3ds'));
  });

  it('reports missing or configured launch dependencies without exposing paths', () => {
    const azahar = path.join(tmpDir, 'azahar.exe');
    const runtime = path.join(tmpDir, 'runtime.3dsx');
    process.env.AZAHAR_PATH = azahar;
    process.env.EMERALD_RUNTIME_PATH = runtime;
    assert.equal(getLauncherStatus().azaharReady, false);
    assert.equal(getLauncherStatus().runtimeReady, false);
    fs.writeFileSync(azahar, 'fake');
    fs.writeFileSync(runtime, 'fake');
    const status = getLauncherStatus();
    assert.equal(status.azaharReady, true);
    assert.equal(status.runtimeReady, true);
    delete process.env.AZAHAR_PATH;
    delete process.env.EMERALD_RUNTIME_PATH;
  });

  it('preserves in-app updates until a newer desktop package supplies a runtime', () => {
    const bundled = path.join(tmpDir, 'bundled.3dsx');
    process.env.EMERALD_RUNTIME_PATH = bundled;
    fs.writeFileSync(bundled, 'bundled-v1');
    assert.equal(ensureRuntimeInstalled(), getInstalledRuntimePath());
    assert.equal(fs.readFileSync(getInstalledRuntimePath(), 'utf8'), 'bundled-v1');

    fs.writeFileSync(getInstalledRuntimePath(), 'self-updated-v2');
    ensureRuntimeInstalled();
    assert.equal(fs.readFileSync(getInstalledRuntimePath(), 'utf8'), 'self-updated-v2');

    fs.writeFileSync(bundled, 'desktop-bundled-v2');
    ensureRuntimeInstalled();
    assert.equal(fs.readFileSync(getInstalledRuntimePath(), 'utf8'), 'desktop-bundled-v2');
  });

  it('redirects Azahar portable user data into the isolated launcher profile on Windows', () => {
    if (process.platform !== 'win32') return;
    const azaharDirectory = path.join(tmpDir, 'azahar');
    const azahar = path.join(azaharDirectory, 'azahar.exe');
    fs.mkdirSync(azaharDirectory);
    fs.writeFileSync(azahar, 'fake');

    ensureAzaharPortableUserDirectory(azahar);

    const portableUser = path.join(azaharDirectory, 'user');
    assert.equal(
      fs.realpathSync(portableUser).toLowerCase(),
      path.join(tmpDir, 'Azahar').toLowerCase()
    );
  });
});
