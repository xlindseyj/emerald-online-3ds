CREATE TABLE device_stat_consent (
  credential_id uuid PRIMARY KEY REFERENCES device_credentials(id) ON DELETE CASCADE,
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(fields) = 'object')
);
CREATE INDEX device_stat_consent_identity_idx ON device_stat_consent(identity_id);

CREATE TABLE leaderboard_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES device_credentials(id) ON DELETE CASCADE,
  release_version varchar(40) NOT NULL,
  board varchar(40) NOT NULL,
  variant varchar(80) NOT NULL DEFAULT '',
  score integer NOT NULL CHECK (score >= 0),
  pending_score integer CHECK (pending_score >= 0),
  integrity_label varchar(32) NOT NULL,
  review_status varchar(20) NOT NULL DEFAULT 'accepted',
  review_reason varchar(120),
  first_submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (credential_id, release_version, board, variant),
  CHECK (integrity_label IN ('Server-observed', 'Peer-confirmed', 'Community-submitted', 'Under review')),
  CHECK (review_status IN ('accepted', 'under-review')),
  CHECK (board IN ('pokedex-seen', 'pokedex-caught', 'badges', 'frontier-streak', 'online-battles', 'online-trades', 'beta-compatibility'))
);
CREATE INDEX leaderboard_entries_board_idx ON leaderboard_entries(release_version, board, variant, review_status, score DESC);
CREATE INDEX leaderboard_entries_identity_idx ON leaderboard_entries(identity_id);

CREATE TABLE stat_snapshot_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES leaderboard_entries(id) ON DELETE CASCADE,
  submitted_score integer NOT NULL CHECK (submitted_score >= 0),
  review_status varchar(20) NOT NULL,
  review_reason varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (review_status IN ('accepted', 'under-review'))
);
CREATE INDEX stat_snapshot_history_entry_idx ON stat_snapshot_history(entry_id, created_at DESC);

CREATE TABLE compatibility_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  release_version varchar(40) NOT NULL,
  artifact_hash char(64) NOT NULL,
  console_model varchar(20) NOT NULL,
  install_method varchar(8) NOT NULL,
  transport varchar(8) NOT NULL,
  result varchar(12) NOT NULL,
  notes varchar(1000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(identity_id, release_version, artifact_hash, console_model, install_method, transport),
  CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  CHECK (console_model IN ('old-3ds','old-3ds-xl','new-3ds','new-3ds-xl','new-2ds-xl','emulator')),
  CHECK (install_method IN ('cia','3dsx')),
  CHECK (transport IN ('wss','tcp')),
  CHECK (result IN ('pass','fail','partial'))
);
CREATE INDEX compatibility_reports_release_idx ON compatibility_reports(release_version, identity_id);

-- These boards intentionally remain disabled until peer-confirmed result detection
-- passes physical battle/trade testing. Gate 3 may display the definitions, but it
-- must not rank client-claimed wins or trades.
CREATE TABLE leaderboard_board_policy (
  board varchar(40) PRIMARY KEY,
  enabled boolean NOT NULL,
  integrity_label varchar(32) NOT NULL,
  explanation text NOT NULL
);
INSERT INTO leaderboard_board_policy(board, enabled, integrity_label, explanation) VALUES
  ('pokedex-seen', true, 'Community-submitted', 'Read from an explicitly consented client-owned save field.'),
  ('pokedex-caught', true, 'Community-submitted', 'Read from an explicitly consented client-owned save field.'),
  ('badges', true, 'Community-submitted', 'Read from explicitly consented badge flags.'),
  ('frontier-streak', true, 'Community-submitted', 'Read from explicitly consented Battle Frontier streak fields.'),
  ('online-battles', false, 'Peer-confirmed', 'Disabled until both clients can physically validate a completed battle result.'),
  ('online-trades', false, 'Peer-confirmed', 'Disabled until both clients can physically validate a completed trade.'),
  ('beta-compatibility', true, 'Server-observed', 'Counts qualifying compatibility reports received by the beta service.');
