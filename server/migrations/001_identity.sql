CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE identities (
  id uuid PRIMARY KEY,
  fingerprint varchar(12) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE device_credentials (
  id uuid PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX device_credentials_identity_idx ON device_credentials(identity_id);

CREATE TABLE identity_recovery (
  identity_id uuid PRIMARY KEY REFERENCES identities(id) ON DELETE CASCADE,
  salt bytea NOT NULL,
  verifier bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE TABLE identity_preferences (
  identity_id uuid PRIMARY KEY REFERENCES identities(id) ON DELETE CASCADE,
  leaderboard_enabled boolean NOT NULL DEFAULT false,
  stat_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE browser_sessions (
  id uuid PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX browser_sessions_identity_idx ON browser_sessions(identity_id);

CREATE TABLE pairing_codes (
  id uuid PRIMARY KEY,
  identity_id uuid REFERENCES identities(id) ON DELETE CASCADE,
  code_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  consumed_at timestamptz
);

CREATE TABLE security_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identity_id uuid REFERENCES identities(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  ip_hash bytea,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX security_events_expiry_idx ON security_events(expires_at);

CREATE TABLE moderation_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_identity_id uuid REFERENCES identities(id) ON DELETE SET NULL,
  target_identity_id uuid REFERENCES identities(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 year')
);
