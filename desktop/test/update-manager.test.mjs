import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { checkForUpdate, compareVersions, fileSha256, validatePublisherSignatures, validateReleaseMetadata, verifyAuthenticode } from '../src/update-manager.mjs';

const release = {
  version: '0.9.0',
  desktop_url: 'https://emeraldonline3ds.com/download/desktop',
  release_notes_url: 'https://emeraldonline3ds.com/',
  sha256_desktop: 'a'.repeat(64)
};

describe('desktop update verification', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo3ds-update-test-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('compares strict release versions', () => {
    assert.equal(compareVersions('0.9.0', '0.8.9'), 1);
    assert.equal(compareVersions('0.8.9', '0.8.9'), 0);
    assert.equal(compareVersions('0.8.8', '0.8.9'), -1);
    assert.throws(() => compareVersions('latest', '0.8.9'), /invalid version/);
  });

  it('accepts only the official installer route with a published checksum', () => {
    const validated = validateReleaseMetadata(release, '0.8.9');
    assert.equal(validated.updateAvailable, true);
    assert.equal(validated.sha256, 'a'.repeat(64));
    assert.throws(() => validateReleaseMetadata({ ...release, desktop_url: 'https://example.com/update.exe' }, '0.8.9'), /untrusted/);
    assert.throws(() => validateReleaseMetadata({ ...release, sha256_desktop: null }, '0.8.9'), /checksum/);
    assert.equal(validateReleaseMetadata({ version: '0.8.9' }, '0.8.9').updateAvailable, false);
  });

  it('checks the official metadata without automatically downloading', async () => {
    let requestedUrl;
    const result = await checkForUpdate('0.8.9', async (url, options) => {
      requestedUrl = url;
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => release };
    });
    assert.equal(requestedUrl, 'https://emeraldonline3ds.com/api/release');
    assert.equal(result.version, '0.9.0');
  });

  it('hashes installers and refuses to treat non-Windows files as signed', async () => {
    const installer = path.join(tmpDir, 'installer.exe');
    fs.writeFileSync(installer, 'synthetic-installer');
    assert.equal(await fileSha256(installer), 'dbc1c3b7dec96a630df9b491b95e95d77c61bcd20288232c3b169f7b3f4860f7');
    assert.deepEqual(await verifyAuthenticode(installer, 'linux'), { valid: false, status: 'Unsupported', signer: null, thumbprint: null });
  });

  it('requires a valid signature and preserves publisher identity after the signed bootstrap', () => {
    const official = { valid: true, status: 'Valid', signer: 'CN=Emerald Online 3DS', thumbprint: 'A1' };
    assert.deepEqual(validatePublisherSignatures(official, { valid: false, status: 'NotSigned' }), {
      signer: official.signer,
      thumbprint: official.thumbprint
    });
    assert.throws(() => validatePublisherSignatures({ valid: false, status: 'NotSigned' }, official), /rejected/);
    assert.throws(() => validatePublisherSignatures({ ...official, signer: 'CN=Unexpected Publisher' }, official), /different publisher/);
  });
});
