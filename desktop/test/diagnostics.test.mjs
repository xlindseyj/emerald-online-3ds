import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { appendDiagnostic, createDiagnosticReport, markLauncherCleanExit, markLauncherStarted, redactDiagnosticText } from '../src/diagnostics.mjs';

describe('privacy-safe diagnostics', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo3ds-diagnostic-test-'));
    process.env.ELECTRON_USER_DATA_PATH = path.join(tmpDir, 'private-user-data');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ELECTRON_USER_DATA_PATH;
  });

  it('redacts user paths, private addresses, emails, and credential-like values', () => {
    const raw = `${process.env.ELECTRON_USER_DATA_PATH} 192.168.4.20 may@example.com token=secret-value`;
    const redacted = redactDiagnosticText(raw);
    assert.doesNotMatch(redacted, /private-user-data|192\.168\.4\.20|may@example\.com|secret-value/);
    assert.match(redacted, /<app-data>|<redacted-ip>|<redacted-email>|<redacted>/);
  });

  it('exports bounded diagnostics without ROM, save, identity, or configuration contents', () => {
    appendDiagnostic('emulator-launch-error', {
      message: `failed under ${process.env.ELECTRON_USER_DATA_PATH} from 10.0.0.8`,
      token: 'credential=super-private'
    });
    const reportPath = path.join(tmpDir, 'diagnostics.txt');
    const result = createDiagnosticReport(reportPath, { appVersion: '0.8.9', azaharReady: true, runtimeReady: true, romPresent: true });
    const report = fs.readFileSync(reportPath, 'utf8');
    assert.ok(result.eventsIncluded >= 1);
    assert.match(report, /excludes ROMs, saves, identities/);
    assert.doesNotMatch(report, /private-user-data|10\.0\.0\.8|super-private/);
  });

  it('detects an unclean previous launcher exit and clears it after a clean exit', () => {
    assert.equal(markLauncherStarted('0.8.9').previousUncleanExit, false);
    assert.equal(markLauncherStarted('0.8.9').previousUncleanExit, true);
    markLauncherCleanExit();
    assert.equal(markLauncherStarted('0.8.9').previousUncleanExit, false);
  });
});
