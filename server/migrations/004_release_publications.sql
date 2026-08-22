CREATE TABLE release_publications (
  release_version text PRIMARY KEY CHECK (release_version ~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$'),
  topic_id uuid NOT NULL UNIQUE REFERENCES forum_topics(id) ON DELETE CASCADE,
  released_at timestamptz NOT NULL,
  source_commit text CHECK (source_commit IS NULL OR source_commit ~ '^[a-f0-9]{7,64}$'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX release_publications_released_idx ON release_publications(released_at DESC);
