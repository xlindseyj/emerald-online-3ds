import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createLocalBackup, deleteLocalData, inspectLocalBackup, restoreLocalBackup } from '../src/data-manager.mjs';
import { getConfigFilePath, getUserDataPath, getVirtualSdPath } from '../src/constants.mjs';

describe('local backup and deletion', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo3ds-data-test-'));
    process.env.ELECTRON_USER_DATA_PATH = path.join(tmpDir, 'user-data');
    fs.mkdirSync(getVirtualSdPath(), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ELECTRON_USER_DATA_PATH;
  });

  it('backs up and restores only the private allowlist while excluding the ROM', () => {
    fs.mkdirSync(path.dirname(getConfigFilePath()), { recursive: true });
    fs.writeFileSync(getConfigFilePath(), '{"name":"May"}\n');
    fs.writeFileSync(path.join(getVirtualSdPath(), 'emerald.sav'), 'save-v1');
    fs.writeFileSync(path.join(getVirtualSdPath(), 'identity.cfg'), 'credential=private-value');
    fs.writeFileSync(path.join(getVirtualSdPath(), 'online.cfg'), 'server=live.emeraldonline3ds.com');
    fs.writeFileSync(path.join(getVirtualSdPath(), 'emerald.gba'), 'must-never-enter-backup');
    fs.writeFileSync(path.join(getVirtualSdPath(), 'emerald-online-3ds.3dsx'), 'runtime');
    fs.writeFileSync(path.join(getVirtualSdPath(), 'gpsp-debug.log'), 'private log');
    fs.mkdirSync(path.join(getVirtualSdPath(), 'link-backups'));
    fs.writeFileSync(path.join(getVirtualSdPath(), 'link-backups', 'emerald-link-123.sav'), 'link-save');

    const target = path.join(tmpDir, 'backup.eobackup');
    const created = createLocalBackup(target, new Date('2026-08-21T12:00:00Z'));
    assert.equal(created.includesIdentity, true);
    const inspected = inspectLocalBackup(target);
    const paths = inspected.files.map(file => file.path);
    assert.ok(paths.includes('sd/emerald.sav'));
    assert.ok(paths.includes('sd/identity.cfg'));
    assert.ok(paths.includes('sd/link-backups/emerald-link-123.sav'));
    assert.ok(!paths.some(file => /emerald\.gba|3dsx|debug/.test(file)));
    assert.equal(inspected.summary.romExcluded, true);

    fs.writeFileSync(path.join(getVirtualSdPath(), 'emerald.sav'), 'changed');
    fs.rmSync(path.join(getVirtualSdPath(), 'identity.cfg'));
    const restored = restoreLocalBackup(target);
    assert.equal(restored.includesSave, true);
    assert.equal(fs.readFileSync(path.join(getVirtualSdPath(), 'emerald.sav'), 'utf8'), 'save-v1');
    assert.equal(fs.readFileSync(path.join(getVirtualSdPath(), 'identity.cfg'), 'utf8'), 'credential=private-value');
    assert.equal(fs.readFileSync(path.join(getVirtualSdPath(), 'emerald.gba'), 'utf8'), 'must-never-enter-backup');
  });

  it('rejects tampered backup contents before restoring anything', () => {
    fs.writeFileSync(path.join(getVirtualSdPath(), 'emerald.sav'), 'original');
    const target = path.join(tmpDir, 'backup.eobackup');
    createLocalBackup(target);
    const archive = JSON.parse(zlib.gunzipSync(fs.readFileSync(target)).toString('utf8'));
    archive.files[0].data = Buffer.from('tampered').toString('base64');
    fs.writeFileSync(target, zlib.gzipSync(JSON.stringify(archive)));
    assert.throws(() => inspectLocalBackup(target), /integrity check failed/);
    assert.equal(fs.readFileSync(path.join(getVirtualSdPath(), 'emerald.sav'), 'utf8'), 'original');
  });

  it('deletes app-private game data but leaves unrelated container files and external backups', () => {
    fs.writeFileSync(path.join(getVirtualSdPath(), 'emerald.gba'), 'rom');
    fs.writeFileSync(path.join(getVirtualSdPath(), 'emerald.sav'), 'save');
    fs.writeFileSync(getConfigFilePath(), '{}');
    fs.writeFileSync(path.join(getUserDataPath(), 'unrelated-electron-file'), 'keep');
    const externalBackup = path.join(tmpDir, 'external.eobackup');
    createLocalBackup(externalBackup);

    const result = deleteLocalData();
    assert.ok(result.removed >= 2);
    assert.equal(fs.existsSync(getVirtualSdPath()), false);
    assert.equal(fs.existsSync(getConfigFilePath()), false);
    assert.equal(fs.existsSync(path.join(getUserDataPath(), 'unrelated-electron-file')), true);
    assert.equal(fs.existsSync(externalBackup), true);
  });
});
