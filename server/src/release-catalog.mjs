import crypto from 'node:crypto';

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/;
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{7,64}$/;
const SAFE_MEDIA = /^\/(?:logo\.png|qr\.svg|release-media\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp|svg))$/;
const SAFE_DOWNLOAD = /^\/[a-z0-9._/-]+$/;

function text(value, name, maximum = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum || /[<>]/.test(value)) {
    throw new Error(`invalid release ${name}`);
  }
  return value.trim();
}

function stringList(value, name, maximumItems = 20) {
  if (!Array.isArray(value) || !value.length || value.length > maximumItems) throw new Error(`invalid release ${name}`);
  return value.map((entry, index) => text(entry, `${name}[${index}]`, 500));
}

export function validateReleaseCatalog(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('release catalog must contain 1-100 entries');
  const versions = new Set();
  const releases = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || !VERSION.test(entry.version ?? '') || versions.has(entry.version)) {
      throw new Error(`invalid or duplicate release version at index ${index}`);
    }
    versions.add(entry.version);
    const releasedAt = new Date(entry.releasedAt);
    if (!Number.isFinite(releasedAt.getTime()) || releasedAt.getTime() > Date.now() + 86400000) throw new Error(`invalid release date for ${entry.version}`);
    if (entry.sourceCommit && !COMMIT.test(entry.sourceCommit)) throw new Error(`invalid source commit for ${entry.version}`);
    const artifacts = Array.isArray(entry.artifacts) ? entry.artifacts.map((artifact, artifactIndex) => {
      if (!artifact || !HASH.test(artifact.sha256 ?? '')) throw new Error(`invalid artifact hash for ${entry.version} at ${artifactIndex}`);
      if (artifact.url && !SAFE_DOWNLOAD.test(artifact.url)) throw new Error(`invalid artifact URL for ${entry.version}`);
      return { label: text(artifact.label, 'artifact label', 80), sha256: artifact.sha256, ...(artifact.url ? { url: artifact.url } : {}) };
    }) : [];
    const media = Array.isArray(entry.media) ? entry.media.map((item, mediaIndex) => {
      if (!item || !SAFE_MEDIA.test(item.url ?? '')) throw new Error(`invalid media URL for ${entry.version} at ${mediaIndex}`);
      return { url: item.url, alt: text(item.alt, 'media alt', 160), caption: text(item.caption, 'media caption', 300) };
    }) : [];
    return {
      version: entry.version,
      releasedAt: releasedAt.toISOString(),
      title: text(entry.title, 'title', 90),
      status: text(entry.status, 'status', 80),
      summary: text(entry.summary, 'summary', 1200),
      highlights: stringList(entry.highlights, 'highlights'),
      verification: stringList(entry.verification, 'verification'),
      knownIssues: stringList(entry.knownIssues, 'knownIssues'),
      upgradeNotes: stringList(entry.upgradeNotes, 'upgradeNotes'),
      artifacts,
      media,
      sourceCommit: entry.sourceCommit ?? null
    };
  });
  return releases.sort((left, right) => new Date(left.releasedAt) - new Date(right.releasedAt));
}

export function formatReleaseTopic(release) {
  const lines = [];
  for (const media of release.media) lines.push(`![${media.alt}](${media.url})`, `*${media.caption}*`, '');
  lines.push(`**Status:** ${release.status}`, `**Released:** ${release.releasedAt.slice(0, 10)}`, '', release.summary, '', '## Highlights');
  for (const item of release.highlights) lines.push(`- ${item}`);
  lines.push('', '## Verification');
  for (const item of release.verification) lines.push(`- ${item}`);
  lines.push('', '## Known limitations');
  for (const item of release.knownIssues) lines.push(`- ${item}`);
  lines.push('', '## Upgrade notes');
  for (const item of release.upgradeNotes) lines.push(`- ${item}`);
  if (release.artifacts.length) {
    lines.push('', '## Artifact checksums');
    for (const artifact of release.artifacts) {
      const label = artifact.url ? `[${artifact.label}](${artifact.url})` : artifact.label;
      lines.push(`- ${label}: \`${artifact.sha256}\``);
    }
  }
  if (release.sourceCommit) lines.push('', `**Source commit:** \`${release.sourceCommit}\``);
  lines.push('', '---', '', 'Back up your save before installing beta builds. This project never provides ROMs; keep your ROM, save, identity credential, and recovery code private. Use replies for results and questions, and put reproducible defects in the Bugs and Defects board.');
  const body = lines.join('\n');
  if (body.length > 10000) throw new Error(`release ${release.version} topic exceeds forum limit`);
  return { title: `Emerald Online 3DS v${release.version} — ${release.title}`, body };
}

export function releaseContentHash(release, topic) {
  return crypto.createHash('sha256').update(JSON.stringify({ release, topic })).digest('hex');
}
