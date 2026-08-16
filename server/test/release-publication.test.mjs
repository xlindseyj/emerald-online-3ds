import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryCommunityStore } from '../src/community-store.mjs';
import { renderMarkdown } from '../src/markdown.mjs';
import { formatReleaseTopic, releaseContentHash, validateReleaseCatalog } from '../src/release-catalog.mjs';
import { formatKnownIssueTopic, knownIssueContentHash, validateKnownIssueCatalog } from '../src/known-issue-catalog.mjs';
import { communityPublicationContentHash, validateCommunityPublicationCatalog } from '../src/community-publication-catalog.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const rawCatalog = JSON.parse(fs.readFileSync(path.join(root, 'release', 'release-catalog.json'), 'utf8'));
const rawKnownIssues = JSON.parse(fs.readFileSync(path.join(root, 'release', 'known-issues.json'), 'utf8'));
const rawCommunityPublications = JSON.parse(fs.readFileSync(path.join(root, 'release', 'community-pages.json'), 'utf8'));

test('release catalog produces structured, image-safe official posts', () => {
  const catalog = validateReleaseCatalog(rawCatalog);
  assert.deepEqual(catalog.map(release => release.version), ['0.3.2', '0.5.0', '0.6.1', '0.7.1', '0.8.0', '0.8.1', '0.8.2', '0.8.3']);
  const current = catalog.at(-1);
  const topic = formatReleaseTopic(current);
  assert.match(topic.title, /v0\.8\.3/);
  assert.match(topic.body, /## Highlights/);
  assert.match(topic.body, /\[CIA\]\(\/emerald-online-3ds\.cia\)/);
  const rendered = renderMarkdown(topic.body);
  assert.match(rendered, /<img src="\/logo\.png"/);
  assert.match(rendered, /<img src="\/qr\.svg"/);
  assert.match(rendered, /<h2>Highlights<\/h2>/);
  assert.match(rendered, /<ul><li>/);
  assert.match(rendered, /href="\/emerald-online-3ds\.cia"/);
  assert.doesNotMatch(rendered, /<script|javascript:/i);
  assert.match(releaseContentHash(current, topic), /^[a-f0-9]{64}$/);
});

test('release catalog rejects duplicate versions and unsafe media', () => {
  assert.throws(() => validateReleaseCatalog([...rawCatalog, rawCatalog[0]]), /duplicate release version/);
  const unsafe = structuredClone(rawCatalog);
  unsafe.at(-1).media[0].url = 'https://tracker.example/screenshot.png';
  assert.throws(() => validateReleaseCatalog(unsafe), /invalid media URL/);
  assert.doesNotMatch(renderMarkdown('![bad](javascript:alert(1))'), /<img/i);
  assert.doesNotMatch(renderMarkdown('![remote](https://tracker.example/a.png)'), /<img/i);
});

test('official release publishing is idempotent and pins only the latest release', async () => {
  const store = new MemoryCommunityStore();
  const catalog = validateReleaseCatalog(rawCatalog);
  let firstTopicId;
  for (const release of catalog) {
    const topic = formatReleaseTopic(release);
    const result = await store.upsertOfficialRelease({ ...release, ...topic, contentHash: releaseContentHash(release, topic) });
    if (release.version === catalog.at(-1).version) firstTopicId = result.topicId;
  }
  const current = catalog.at(-1), topic = formatReleaseTopic(current);
  const repeated = await store.upsertOfficialRelease({ ...current, ...topic, contentHash: releaseContentHash(current, topic) });
  assert.equal(repeated.topicId, firstTopicId);
  assert.equal(await store.pinLatestOfficialRelease(current.version), true);
  const listed = await store.listTopics({ category: 'releases', viewer: null });
  assert.equal(listed.topics.length, catalog.length);
  assert.equal(listed.topics.filter(item => item.pinned).length, 1);
  assert.equal(listed.topics[0].release_version, current.version);
  assert.equal(listed.topics[0].official_release, true);
  assert.equal(listed.topics[0].author_identity_id, null);
});

test('confirmed FPS issue publishes idempotently with the recovery workaround', async () => {
  const [issue] = validateKnownIssueCatalog(rawKnownIssues);
  const topic = formatKnownIssueTopic(issue);
  assert.match(topic.title, /FPS can fluctuate/);
  assert.match(topic.body, /Press X once to turn Online mode off/);
  assert.match(topic.body, /Press X again to re-enable Online mode/);
  assert.match(topic.body, /var(?:y|ies) between devices and scenes/i);
  assert.doesNotMatch(topic.body, /identity\.cfg.*[=:]/i);
  const rendered = renderMarkdown(topic.body);
  assert.match(rendered, /<h2>Temporary workaround<\/h2>/);
  assert.doesNotMatch(rendered, /<script|javascript:/i);

  const store = new MemoryCommunityStore();
  const publication = { ...issue, ...topic, contentHash: knownIssueContentHash(issue, topic) };
  const first = await store.upsertOfficialKnownIssue(publication);
  const repeated = await store.upsertOfficialKnownIssue(publication);
  assert.equal(repeated.topicId, first.topicId);
  const published = await store.getTopic(first.topicId, null);
  assert.equal(published.official_known_issue, true);
  assert.equal(published.known_issue_key, 'fluctuating-fps-after-scenes');
  assert.equal(published.defect_status, 'confirmed');
  assert.equal(published.author_identity_id, null);
});

test('official guides and status pages populate every forum purpose idempotently', async () => {
  const publications = validateCommunityPublicationCatalog(rawCommunityPublications);
  assert.equal(publications.length, 9);
  assert.deepEqual(new Set(publications.map(item => item.category)), new Set([
    'announcements', 'installation-help', 'service-status', 'beta-testing',
    'development-code', 'feature-ideas', 'multiplayer-help', 'general'
  ]));
  const install = publications.find(item => item.key === 'install-on-3ds');
  const emulator = publications.find(item => item.key === 'test-with-azahar');
  const status = publications.find(item => item.key === 'live-service-status');
  assert.match(renderMarkdown(install.body), /<img src="\/qr\.svg"/);
  assert.match(renderMarkdown(emulator.body), /release-media\/online-dashboard\.png/);
  assert.match(status.body, /https:\/\/emeraldonline3ds\.com\/community/);
  assert.match(status.body, /wss:\/\/live\.emeraldonline3ds\.com\/game/);

  const store = new MemoryCommunityStore();
  let firstTopicId;
  for (const publication of publications) {
    const result = await store.upsertOfficialCommunityPublication({
      ...publication,
      contentHash: communityPublicationContentHash(publication)
    });
    if (publication.key === 'live-service-status') firstTopicId = result.topicId;
  }
  const repeated = await store.upsertOfficialCommunityPublication({
    ...status,
    contentHash: communityPublicationContentHash(status)
  });
  assert.equal(repeated.topicId, firstTopicId);
  const topic = await store.getOfficialCommunityPublication('live-service-status', null);
  assert.equal(topic.official_publication, true);
  assert.equal(topic.publication_kind, 'status');
  assert.equal(topic.pinned, true);
});
