-- Phase 2A: title inventory and equipped title pointer.

CREATE TABLE IF NOT EXISTS player_titles (
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, title)
);

-- Existing equipped titles from Phase 1 become the first inventory entry.
INSERT INTO player_titles (identity_id, title, unlocked_at)
SELECT identity_id, title, updated_at FROM identity_titles
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS player_titles_identity_idx ON player_titles(identity_id);
