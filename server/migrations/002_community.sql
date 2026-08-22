ALTER TABLE pairing_codes
  ADD COLUMN request_hash bytea,
  ADD COLUMN approved_by_credential_id uuid REFERENCES device_credentials(id) ON DELETE SET NULL;

CREATE TABLE identity_roles (
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('moderator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, role)
);

CREATE TABLE identity_blocks (
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  blocked_identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, blocked_identity_id),
  CHECK (identity_id <> blocked_identity_id)
);

CREATE TABLE identity_sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  actor_identity_id uuid REFERENCES identities(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('warning', 'read-only', 'suspended')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE INDEX identity_sanctions_active_idx ON identity_sanctions(identity_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE forum_categories (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 240),
  visibility text NOT NULL CHECK (visibility IN ('public', 'paired', 'moderator')),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO forum_categories (slug, name, description, visibility, position) VALUES
  ('announcements', 'Announcements', 'Service announcements and important community notices.', 'public', 10),
  ('releases', 'Releases', 'Release notes, checksums, compatibility notes, and upgrade help.', 'public', 20),
  ('installation-help', 'Installation Help', 'Public installation, recovery, and connection guidance.', 'public', 30),
  ('service-status', 'Service Status', 'Public incidents, maintenance, and service restoration updates.', 'public', 40),
  ('beta-testing', 'Beta Testing', 'Paired-player testing feedback and compatibility discussion.', 'paired', 50),
  ('bugs-defects', 'Bugs and Defects', 'Structured defect reports and linked investigation discussion.', 'paired', 60),
  ('development-code', 'Development and Code', 'Implementation, protocol, testing, and code discussion.', 'paired', 70),
  ('feature-ideas', 'Feature Ideas', 'Focused proposals for improving Emerald Online 3DS.', 'paired', 80),
  ('multiplayer-help', 'Multiplayer Help', 'Troubleshooting presence, chat, and future link sessions.', 'paired', 90),
  ('general', 'General Discussion', 'Paired-player community conversation.', 'paired', 100),
  ('moderation', 'Moderation', 'Private reports, sanctions, and moderation coordination.', 'moderator', 110)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  visibility = EXCLUDED.visibility,
  position = EXCLUDED.position;

CREATE TABLE forum_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_slug text NOT NULL REFERENCES forum_categories(slug),
  author_identity_id uuid REFERENCES identities(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  body_markdown text NOT NULL CHECK (char_length(body_markdown) BETWEEN 1 AND 10000),
  pinned boolean NOT NULL DEFAULT false,
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  purge_after timestamptz
);
CREATE INDEX forum_topics_category_updated_idx ON forum_topics(category_slug, pinned DESC, updated_at DESC);
CREATE INDEX forum_topics_search_idx ON forum_topics USING gin(to_tsvector('simple', title || ' ' || body_markdown));

CREATE TABLE forum_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  author_identity_id uuid REFERENCES identities(id) ON DELETE SET NULL,
  body_markdown text NOT NULL CHECK (char_length(body_markdown) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  purge_after timestamptz
);
CREATE INDEX forum_posts_topic_created_idx ON forum_posts(topic_id, created_at);

CREATE TABLE forum_subscriptions (
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, topic_id)
);

CREATE TABLE forum_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_identity_id uuid REFERENCES identities(id) ON DELETE SET NULL,
  topic_id uuid REFERENCES forum_topics(id) ON DELETE CASCADE,
  post_id uuid REFERENCES forum_posts(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  evidence_expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  resolved_at timestamptz,
  CHECK ((topic_id IS NOT NULL)::integer + (post_id IS NOT NULL)::integer = 1)
);
CREATE INDEX forum_reports_status_created_idx ON forum_reports(status, created_at);

CREATE TABLE defects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL UNIQUE REFERENCES forum_topics(id) ON DELETE CASCADE,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  reproduction_steps text NOT NULL CHECK (char_length(reproduction_steps) BETWEEN 1 AND 10000),
  expected_behavior text NOT NULL CHECK (char_length(expected_behavior) BETWEEN 1 AND 5000),
  actual_behavior text NOT NULL CHECK (char_length(actual_behavior) BETWEEN 1 AND 5000),
  runtime_version text NOT NULL CHECK (char_length(runtime_version) BETWEEN 1 AND 40),
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  console_model text NOT NULL CHECK (console_model IN ('old-3ds', 'old-3ds-xl', 'new-3ds', 'new-3ds-xl', 'new-2ds-xl', 'emulator')),
  install_method text NOT NULL CHECK (install_method IN ('cia', '3dsx')),
  transport text NOT NULL CHECK (transport IN ('wss', 'tcp')),
  diagnostic_text text NOT NULL DEFAULT '' CHECK (char_length(diagnostic_text) <= 10000),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'needs-information', 'confirmed', 'in-progress', 'needs-retest', 'fixed', 'closed')),
  target_release text CHECK (target_release IS NULL OR char_length(target_release) <= 40),
  related_change text CHECK (related_change IS NULL OR char_length(related_change) <= 240),
  duplicate_of uuid REFERENCES defects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX defects_status_updated_idx ON defects(status, updated_at DESC);
