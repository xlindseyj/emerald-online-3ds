import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getUserDataPath } from './constants.mjs';

export const UPDATE_API_URL = 'https://emeraldonline3ds.com/api/release';
const UPDATE_ORIGIN = 'https://emeraldonline3ds.com';
const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;

function parseVersion(value) {
  const match = String(value ?? '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error('Release service returned an invalid version.');
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function validateReleaseMetadata(raw, currentVersion) {
  const version = String(raw?.version ?? '');
  parseVersion(version);
  parseVersion(currentVersion);
  const updateAvailable = compareVersions(version, currentVersion) > 0;
  if (!updateAvailable) return { version, updateAvailable: false, releaseNotesUrl: `${UPDATE_ORIGIN}/` };

  let downloadUrl;
  let notesUrl;
  try {
    downloadUrl = new URL(String(raw?.desktop_url ?? ''));
    notesUrl = new URL(String(raw?.release_notes_url ?? `${UPDATE_ORIGIN}/`));
  } catch {
    throw new Error('The newer release does not provide a valid Windows installer.');
  }
  if (downloadUrl.origin !== UPDATE_ORIGIN || downloadUrl.pathname !== '/download/desktop' || downloadUrl.search || downloadUrl.hash) {
    throw new Error('Release service returned an untrusted installer URL.');
  }
  if (notesUrl.origin !== UPDATE_ORIGIN) throw new Error('Release service returned an untrusted release-notes URL.');
  const sha256 = String(raw?.sha256_desktop ?? '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Release service did not provide a valid installer checksum.');
  return { version, updateAvailable: true, downloadUrl: downloadUrl.href, releaseNotesUrl: notesUrl.href, sha256 };
}

export async function checkForUpdate(currentVersion, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Secure update checks are unavailable in this runtime.');
  const response = await fetchImpl(UPDATE_API_URL, {
    method: 'GET',
    cache: 'no-store',
    redirect: 'error',
    headers: { accept: 'application/json', 'user-agent': `EmeraldOnline3DS/${currentVersion}` },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Release service returned HTTP ${response.status}.`);
  return validateReleaseMetadata(await response.json(), currentVersion);
}

function download(url, targetPath, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.origin !== UPDATE_ORIGIN || parsed.protocol !== 'https:') return reject(new Error('Refusing an untrusted update download.'));
    const request = https.get(parsed, { headers: { 'user-agent': 'EmeraldOnline3DS-Desktop' }, timeout: 30_000 }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        response.resume();
        if (redirects >= 3 || !response.headers.location) return reject(new Error('Too many update redirects.'));
        const next = new URL(response.headers.location, parsed);
        if (next.origin !== UPDATE_ORIGIN) return reject(new Error('Update redirected to an untrusted host.'));
        download(next.href, targetPath, onProgress, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Installer download returned HTTP ${response.statusCode}.`));
        return;
      }
      const expected = Number(response.headers['content-length'] ?? 0);
      if (expected > MAX_INSTALLER_BYTES) {
        response.resume();
        reject(new Error('Installer is larger than the safety limit.'));
        return;
      }
      let received = 0;
      const output = fs.createWriteStream(targetPath, { mode: 0o600 });
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (received > MAX_INSTALLER_BYTES) callback(new Error('Installer exceeded the safety limit.'));
          else {
            onProgress?.({ received, total: expected || null });
            callback(null, chunk);
          }
        }
      });
      pipeline(response, meter, output).then(() => resolve({ received }), reject);
    });
    request.on('timeout', () => request.destroy(new Error('Installer download timed out.')));
    request.on('error', reject);
  });
}

export async function fileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export function verifyAuthenticode(filePath, platform = process.platform) {
  if (platform !== 'win32') return Promise.resolve({ valid: false, status: 'Unsupported', signer: null, thumbprint: null });
  const command = [
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:EMERALD_UPDATE_PATH",
    "$subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }",
    "$thumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }",
    "@{ status = [string]$signature.Status; subject = $subject; thumbprint = $thumbprint } | ConvertTo-Json -Compress"
  ].join('; ');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      timeout: 30_000,
      env: { ...process.env, EMERALD_UPDATE_PATH: filePath }
    }, (error, stdout) => {
      if (error) return reject(new Error(`Windows could not verify the installer signature: ${error.message}`));
      try {
        const result = JSON.parse(stdout.trim());
        resolve({ valid: result.status === 'Valid' && Boolean(result.subject) && Boolean(result.thumbprint), status: result.status, signer: result.subject ?? null, thumbprint: result.thumbprint ?? null });
      } catch {
        reject(new Error('Windows returned an invalid signature result.'));
      }
    });
  });
}

export function validatePublisherSignatures(updateSignature, currentSignature) {
  if (!updateSignature?.valid) throw new Error(`Windows rejected the installer signature (${updateSignature?.status ?? 'Unknown'}).`);
  if (currentSignature?.valid && currentSignature.signer !== updateSignature.signer) {
    throw new Error('The update was signed by a different publisher than the installed application.');
  }
  return { signer: updateSignature.signer, thumbprint: updateSignature.thumbprint };
}

export async function downloadVerifiedUpdate(release, { onProgress, signatureVerifier = verifyAuthenticode, currentExecutable = process.execPath } = {}) {
  if (!release?.updateAvailable) throw new Error('No update is available.');
  const updateDirectory = path.join(getUserDataPath(), 'updates');
  const finalPath = path.join(updateDirectory, `EmeraldOnline3DS-Setup-${release.version}.exe`);
  const temporary = `${finalPath}.download`;
  fs.mkdirSync(updateDirectory, { recursive: true });
  try {
    fs.rmSync(temporary, { force: true });
    await download(release.downloadUrl, temporary, onProgress);
    const checksum = await fileSha256(temporary);
    if (checksum !== release.sha256) throw new Error('Downloaded installer checksum did not match the signed release manifest.');
    const signature = await signatureVerifier(temporary);
    const currentSignature = await signatureVerifier(currentExecutable);
    validatePublisherSignatures(signature, currentSignature);
    fs.rmSync(finalPath, { force: true });
    fs.renameSync(temporary, finalPath);
    return { path: finalPath, checksum, signer: signature.signer, signerThumbprint: signature.thumbprint, version: release.version };
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}
