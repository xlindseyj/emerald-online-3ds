-- Phase 4: world resource nodes and player skills

CREATE TABLE IF NOT EXISTS resource_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(64) UNIQUE NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tree','rock','water')),
  map varchar(32) NOT NULL,
  x integer NOT NULL CHECK (x BETWEEN 0 AND 4095),
  y integer NOT NULL CHECK (y BETWEEN 0 AND 4095),
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 99),
  respawn_seconds integer NOT NULL DEFAULT 30 CHECK (respawn_seconds BETWEEN 1 AND 86400),
  active boolean NOT NULL DEFAULT true,
  last_harvested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resource_nodes_map_idx ON resource_nodes(map);

CREATE TABLE IF NOT EXISTS player_skills (
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  skill text NOT NULL CHECK (skill IN ('woodcutting','mining','fishing')),
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 99),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, skill)
);

-- Seed a starter resource node on Littleroot map 0-9 near the scientist.
INSERT INTO resource_nodes (slug, kind, map, x, y, level, respawn_seconds, active)
VALUES ('littleroot-apple-tree', 'tree', '0-9', 12, 13, 1, 30, true)
ON CONFLICT (slug) DO NOTHING;

-- Extend the quest chain. First quest already exists from migration 009.
WITH welcome AS (
  SELECT id FROM quests WHERE slug = 'welcome-to-hoenn-online' LIMIT 1
)
INSERT INTO quests (slug, title, description, requirements, reward_kind, reward_data, active)
SELECT
  'field-research',
  'Field Research',
  'The scientist wants a sample from a nearby resource node. Interact with the apple tree just west of the lab.',
  jsonb_build_array(
    jsonb_build_object('kind', 'quest_completed', 'quest_id', welcome.id::text),
    jsonb_build_object('kind', 'interact_resource', 'node_id', 'littleroot-apple-tree')
  ),
  'title',
  '{"title":"Beta Pioneer II"}'::jsonb,
  true
FROM welcome
ON CONFLICT (slug) DO NOTHING;

WITH field AS (
  SELECT id FROM quests WHERE slug = 'field-research' LIMIT 1
)
INSERT INTO quests (slug, title, description, requirements, reward_kind, reward_data, active)
SELECT
  'report-findings',
  'Report Findings',
  'Return to the scientist with the sample.',
  jsonb_build_array(
    jsonb_build_object('kind', 'quest_completed', 'quest_id', field.id::text),
    jsonb_build_object('kind', 'talk_to_npc', 'npc_id', 'scientist-welcome')
  ),
  'title',
  '{"title":"Research Assistant"}'::jsonb,
  true
FROM field
ON CONFLICT (slug) DO NOTHING;
