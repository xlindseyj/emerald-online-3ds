CREATE TABLE known_issue_publications (
  issue_key text PRIMARY KEY CHECK (issue_key ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  topic_id uuid NOT NULL UNIQUE REFERENCES forum_topics(id) ON DELETE CASCADE,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
