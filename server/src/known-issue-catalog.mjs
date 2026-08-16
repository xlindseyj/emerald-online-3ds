import crypto from 'node:crypto';

const KEY = /^[a-z0-9][a-z0-9-]{2,79}$/;
const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/;
const MODELS = new Set(['old-3ds', 'old-3ds-xl', 'new-3ds', 'new-3ds-xl', 'new-2ds-xl', 'emulator']);
const INSTALLS = new Set(['cia', '3dsx']);
const TRANSPORTS = new Set(['wss', 'tcp']);
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function text(value, name, maximum = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum || /[<>]/.test(value)) throw new Error(`invalid known issue ${name}`);
  return value.trim();
}

function list(value, name) {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error(`invalid known issue ${name}`);
  return value.map((entry, index) => text(entry, `${name}[${index}]`, 500));
}

export function validateKnownIssueCatalog(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('known issue catalog must contain 1-100 entries');
  const keys = new Set();
  return value.map((entry, index) => {
    if (!entry || !KEY.test(entry.key ?? '') || keys.has(entry.key)) throw new Error(`invalid or duplicate known issue key at index ${index}`);
    keys.add(entry.key);
    if (!SEVERITIES.has(entry.severity) || !VERSION.test(entry.runtimeVersion ?? '') || !HASH.test(entry.artifactHash ?? '') ||
        !MODELS.has(entry.consoleModel) || !INSTALLS.has(entry.installMethod) || !TRANSPORTS.has(entry.transport)) throw new Error(`invalid known issue metadata for ${entry.key}`);
    return {
      key: entry.key,
      title: text(entry.title, 'title', 100),
      severity: entry.severity,
      runtimeVersion: entry.runtimeVersion,
      artifactHash: entry.artifactHash,
      consoleModel: entry.consoleModel,
      installMethod: entry.installMethod,
      transport: entry.transport,
      summary: text(entry.summary, 'summary', 1200),
      observations: list(entry.observations, 'observations'),
      workaround: list(entry.workaround, 'workaround'),
      requestedEvidence: list(entry.requestedEvidence, 'requestedEvidence'),
      expectedBehavior: text(entry.expectedBehavior, 'expectedBehavior', 5000),
      actualBehavior: text(entry.actualBehavior, 'actualBehavior', 5000),
      diagnosticText: text(entry.diagnosticText, 'diagnosticText', 10000)
    };
  });
}

export function formatKnownIssueTopic(issue) {
  const lines = [
    '**Status:** Confirmed — under investigation',
    `**Affected release:** ${issue.runtimeVersion}`,
    `**Severity:** ${issue.severity}`,
    '', issue.summary, '', '## What we have observed'
  ];
  for (const item of issue.observations) lines.push(`- ${item}`);
  lines.push('', '## Temporary workaround');
  for (const item of issue.workaround) lines.push(`- ${item}`);
  lines.push('', '## Help us narrow it down');
  for (const item of issue.requestedEvidence) lines.push(`- ${item}`);
  lines.push('', '---', '', 'Reply with sanitized results. Do not post ROM data, save files, identity.cfg, recovery codes, screenshots containing personal information, or copyrighted game assets. This workaround is not considered a fix; the issue remains open until frame pacing is stable across supported devices and scenes.');
  const body = lines.join('\n');
  if (body.length > 10000) throw new Error(`known issue ${issue.key} exceeds forum limit`);
  return { title: `Known issue: ${issue.title}`, body };
}

export function knownIssueContentHash(issue, topic) {
  return crypto.createHash('sha256').update(JSON.stringify({ issue, topic })).digest('hex');
}
