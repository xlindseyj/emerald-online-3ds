import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { readConfig, writeConfig, sanitizeTrainerName, sanitizeServerHost, sanitizeServerPath, normalizeConfig } from '../src/config-store.mjs';
import { getConfigFilePath } from '../src/constants.mjs';

describe('config-store', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo3ds-config-test-'));
    process.env.ELECTRON_USER_DATA_PATH = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ELECTRON_USER_DATA_PATH;
  });

  it('returns defaults when no config exists', () => {
    const cfg = readConfig();
    assert.equal(cfg.server, 'live.emeraldonline3ds.com');
    assert.equal(cfg.port, 443);
    assert.equal(cfg.transport, 'wss');
    assert.equal(cfg.path, '/game');
    assert.equal(cfg.name, 'Trainer');
    assert.equal(cfg.online, true);
  });

  it('reads previously written config', () => {
    writeConfig({ name: 'Brendan', port: 3210, transport: 'tcp' });
    const cfg = readConfig();
    assert.equal(cfg.name, 'Brendan');
    assert.equal(cfg.port, 3210);
    assert.equal(cfg.transport, 'tcp');
    assert.equal(cfg.server, 'live.emeraldonline3ds.com');
  });

  it('persists config to disk', () => {
    writeConfig({ name: 'May' });
    const file = getConfigFilePath();
    assert.ok(fs.existsSync(file));
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed.name, 'May');
  });

  it('validates trainer names', () => {
    assert.equal(sanitizeTrainerName('May'), 'May');
    assert.throws(() => sanitizeTrainerName(''), /1-12/);
    assert.throws(() => sanitizeTrainerName('a'.repeat(13)), /1-12/);
    assert.throws(() => sanitizeTrainerName('May"'), /quotes/);
  });

  it('validates server paths', () => {
    assert.equal(sanitizeServerPath('/game'), '/game');
    assert.throws(() => sanitizeServerPath('game'), /start with \//);
    assert.throws(() => sanitizeServerPath('/' + 'a'.repeat(130)), /too long/);
    assert.throws(() => sanitizeServerPath('/game\nname=Injected'), /unsupported/);
    assert.throws(() => sanitizeServerPath('/game?token=secret'), /unsupported/);
  });

  it('validates server hosts and prevents config-line injection', () => {
    assert.equal(sanitizeServerHost('LIVE.EMERALDONLINE3DS.COM'), 'live.emeraldonline3ds.com');
    assert.equal(sanitizeServerHost('127.0.0.1'), '127.0.0.1');
    assert.throws(() => sanitizeServerHost('https://example.com'), /without a scheme/);
    assert.throws(() => sanitizeServerHost('server\nname=Injected'), /without a scheme/);
    assert.throws(() => sanitizeServerHost('999.1.1.1'), /invalid IPv4/);
  });

  it('normalizes every supported desktop setting', () => {
    const cfg = normalizeConfig({ name: 'May', page: 'guild', online: false });
    assert.equal(cfg.page, 'guild');
    assert.equal(cfg.online, false);
    assert.throws(() => normalizeConfig({ page: 'unknown' }), /Invalid starting page/);
  });
});
