CREATE TABLE community_publications (
  publication_key text PRIMARY KEY CHECK (publication_key ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  topic_id uuid NOT NULL UNIQUE REFERENCES forum_topics(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('guide', 'status', 'welcome')),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX community_publications_kind_idx ON community_publications(kind, updated_at DESC);
