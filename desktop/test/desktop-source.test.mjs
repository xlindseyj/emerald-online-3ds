import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = fs.readdirSync(srcDir, { recursive: true })
  .filter(name => name.endsWith('.mjs') || name.endsWith('.cjs') || name.endsWith('.html') || name.endsWith('.css'))
  .map(name => path.join(srcDir, name));
const desktopRoot = path.resolve(srcDir, '..');

describe('desktop source invariants', () => {
  it('does not hardcode private IP addresses or infrastructure identifiers', () => {
    const forbidden = [
      /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/,
      /\bprivate-node\b/, /\binternal-registry\b/, /\binternal-namespace\b/,
      /\b192\.168\.0\.31:30501\b/
    ];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        if (pattern.test(text)) assert.fail(`forbidden pattern ${pattern} in ${file}`);
      }
    }
  });

  it('does not embed a ROM path or filename other than the user-supplied emerald.gba', () => {
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!/Pokemon - Emerald Version\.gba/.test(text), `embedded ROM filename in ${file}`);
    }
  });

  it('keeps the production endpoint public and well-known', () => {
    let found = false;
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      if (/live\.emeraldonline3ds\.com/.test(text)) found = true;
    }
    assert.ok(found, 'production endpoint constant missing');
  });

  it('keeps ROM validation inside the packaged desktop source', () => {
    const validator = fs.readFileSync(path.join(srcDir, 'rom-validator.mjs'), 'utf8');
    assert.match(validator, /SUPPORTED_EMERALD_SHA256/);
    assert.doesNotMatch(validator, /tools[\\/]inspect-rom/);
  });

  it('keeps installer license inputs inside the standalone desktop directory', () => {
    const packageConfig = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
    const resources = packageConfig.build.extraResources;
    assert.equal(resources.some(resource => resource.from === '../third_party/gpsp/COPYING'), false);
    assert.equal(resources.some(resource => resource.from === '../THIRD_PARTY.md'), false);
    assert.equal(packageConfig.build.nsis.license, 'resources/licenses/GPL-2.0.txt');
    assert.ok(fs.statSync(path.join(desktopRoot, 'resources', 'licenses', 'GPL-2.0.txt')).size > 15_000);
    assert.ok(fs.statSync(path.join(desktopRoot, 'resources', 'licenses', 'THIRD_PARTY.md')).size > 500);
  });

  it('uses a sandboxed, context-isolated renderer and blocks arbitrary navigation', () => {
    const main = fs.readFileSync(path.join(srcDir, 'main.mjs'), 'utf8');
    assert.match(main, /contextIsolation:\s*true/);
    assert.match(main, /nodeIntegration:\s*false/);
    assert.match(main, /sandbox:\s*true/);
    assert.match(main, /setWindowOpenHandler/);
    assert.match(main, /will-navigate/);
  });

  it('ships every current lower-screen page in launcher settings', () => {
    const html = fs.readFileSync(path.join(srcDir, 'renderer', 'index.html'), 'utf8');
    for (const page of ['online', 'users', 'chat', 'party', 'bag', 'map', 'stats', 'quest', 'titles', 'friends', 'guild', 'teleport', 'update']) {
      assert.match(html, new RegExp(`value="${page}"`));
    }
  });

  it('writes only runtime configuration keys that the bundled 3DSX understands', () => {
    const projectRoot = path.resolve(srcDir, '..', '..');
    const runtime = fs.readFileSync(path.join(projectRoot, 'gpsp-runtime', 'source', 'main.cpp'), 'utf8');
    const launcher = fs.readFileSync(path.join(srcDir, 'azahar-launcher.mjs'), 'utf8');
    assert.match(launcher, /online=\$\{normalized\.online \? 'enabled' : 'disabled'\}/);
    assert.match(launcher, /dynarec=disabled/);
    assert.match(runtime, /!strcmp\(line, "online"\).*onlineEnabled/);
    assert.match(runtime, /!strcmp\(line, "dynarec"\).*dynarecEnabled/);
  });

  it('keeps backups local, excludes ROMs, and requires signed update installers', () => {
    const dataManager = fs.readFileSync(path.join(srcDir, 'data-manager.mjs'), 'utf8');
    const updater = fs.readFileSync(path.join(srcDir, 'update-manager.mjs'), 'utf8');
    assert.match(dataManager, /excluded: \['emerald\.gba'/);
    assert.doesNotMatch(dataManager, /fetch\(|https\.request|https\.get/);
    assert.match(updater, /sha256/);
    assert.match(updater, /Get-AuthenticodeSignature/);
    assert.match(updater, /if \(!updateSignature\?\.valid\) throw/);
    assert.match(updater, /different publisher than the installed application/);
  });
});
