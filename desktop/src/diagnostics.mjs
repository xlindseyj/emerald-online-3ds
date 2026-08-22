import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getUserDataPath } from './constants.mjs';

const MAX_LOG_BYTES = 256 * 1024;

export function redactDiagnosticText(value) {
  return String(value ?? '')
    .replaceAll(getUserDataPath(), '<app-data>')
    .replace(/\b(?:10|127)\.(?:\d{1,3}\.){2}\d{1,3}\b/g, '<redacted-ip>')
    .replace(/\b192\.168\.(?:\d{1,3}\.)\d{1,3}\b/g, '<redacted-ip>')
    .replace(/\b172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}\b/g, '<redacted-ip>')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '<redacted-email>')
    .replace(/\b(?:token|secret|recovery(?:_code)?|credential)\s*[=:]\s*[^\s,;]+/gi, '$1=<redacted>')
    .replace(/\b[0-9a-f]{32,}\b/gi, '<redacted-value>')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, '<user-profile>')
    .replace(/\/home\/[^/\s]+/g, '<user-profile>')
    .slice(0, 4000);
}

function diagnosticDirectory() {
  return path.join(getUserDataPath(), 'diagnostics');
}

export function diagnosticLogPath() {
  return path.join(diagnosticDirectory(), 'launcher.jsonl');
}

function sanitizeDetails(details = {}) {
  const result = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null) continue;
    result[key] = typeof value === 'string' ? redactDiagnosticText(value) :
      typeof value === 'number' || typeof value === 'boolean' ? value : redactDiagnosticText(JSON.stringify(value));
  }
  return result;
}

export function appendDiagnostic(event, details = {}, now = new Date()) {
  const directory = diagnosticDirectory();
  const logPath = diagnosticLogPath();
  fs.mkdirSync(directory, { recursive: true });
  const stat = fs.statSync(logPath, { throwIfNoEntry: false });
  if (stat?.size > MAX_LOG_BYTES) {
    fs.rmSync(`${logPath}.previous`, { force: true });
    fs.renameSync(logPath, `${logPath}.previous`);
  }
  const line = `${JSON.stringify({ at: now.toISOString(), event: redactDiagnosticText(event), details: sanitizeDetails(details) })}\n`;
  fs.appendFileSync(logPath, line, { encoding: 'utf8', mode: 0o600 });
}

function crashStatePath() {
  return path.join(getUserDataPath(), 'crash-state.json');
}

function readCrashState() {
  try { return JSON.parse(fs.readFileSync(crashStatePath(), 'utf8')); }
  catch { return null; }
}

function writeCrashState(state) {
  const target = crashStatePath();
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
}

export function markLauncherStarted(appVersion, now = new Date()) {
  const previous = readCrashState();
  writeCrashState({ cleanExit: false, startedAt: now.toISOString(), appVersion });
  return { previousUncleanExit: previous?.cleanExit === false, previousStartedAt: previous?.startedAt ?? null };
}

export function markLauncherCleanExit(now = new Date()) {
  const current = readCrashState() ?? {};
  writeCrashState({ ...current, cleanExit: true, endedAt: now.toISOString() });
}

export function createDiagnosticReport(targetPath, details = {}, now = new Date()) {
  let log = '';
  try { log = fs.readFileSync(diagnosticLogPath(), 'utf8').slice(-MAX_LOG_BYTES); } catch {}
  const report = [
    'Emerald Online 3DS privacy-safe diagnostics',
    `Generated: ${now.toISOString()}`,
    `App version: ${redactDiagnosticText(details.appVersion ?? 'unknown')}`,
    `Platform: ${process.platform} ${process.arch}`,
    `OS release: ${redactDiagnosticText(os.release())}`,
    `Azahar available: ${Boolean(details.azaharReady)}`,
    `Runtime available: ${Boolean(details.runtimeReady)}`,
    `ROM present: ${Boolean(details.romPresent)}`,
    '',
    'This report excludes ROMs, saves, identities, configuration values, and user paths.',
    '',
    'Redacted launcher events:',
    redactDiagnosticText(log).replaceAll('><', '>\n<')
  ].join('\n');
  const temporary = `${targetPath}.tmp`;
  fs.writeFileSync(temporary, `${report}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.rmSync(targetPath, { force: true });
  fs.renameSync(temporary, targetPath);
  return { path: targetPath, bytes: Buffer.byteLength(report), eventsIncluded: log.split('\n').filter(Boolean).length };
}
