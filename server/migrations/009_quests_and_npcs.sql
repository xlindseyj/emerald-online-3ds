-- Phase 1: online NPCs and quests

CREATE TABLE IF NOT EXISTS quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(64) UNIQUE NOT NULL,
  title varchar(120) NOT NULL,
  description text NOT NULL,
  requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  reward_kind varchar(40) NOT NULL CHECK (reward_kind IN ('title','item','teleport','none')),
  reward_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS npc_spawns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(64) UNIQUE NOT NULL,
  quest_id uuid REFERENCES quests(id) ON DELETE SET NULL,
  name varchar(120) NOT NULL,
  map varchar(32) NOT NULL,
  x integer NOT NULL CHECK (x BETWEEN 0 AND 4095),
  y integer NOT NULL CHECK (y BETWEEN 0 AND 4095),
  facing text NOT NULL CHECK (facing IN ('up','down','left','right')),
  sprite varchar(40) NOT NULL,
  dialogue jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_quest_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  quest_id uuid NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('accepted','completed','claimed')),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_id, quest_id)
);

CREATE TABLE IF NOT EXISTS identity_titles (
  identity_id uuid PRIMARY KEY REFERENCES identities(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS npc_spawns_map_idx ON npc_spawns(map);
CREATE INDEX IF NOT EXISTS player_quest_progress_identity_idx ON player_quest_progress(identity_id);
CREATE INDEX IF NOT EXISTS player_quest_progress_quest_idx ON player_quest_progress(quest_id);

-- Seed the Phase 1 scientist NPC and welcome quest.
INSERT INTO quests (slug, title, description, requirements, reward_kind, reward_data, active)
VALUES (
  'welcome-to-hoenn-online',
  'Welcome to Hoenn Online',
  'The scientist in Littleroot needs your help testing the online connection.',
  '[]'::jsonb,
  'title',
  '{"title":"Beta Pioneer"}'::jsonb,
  true
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO npc_spawns (slug, quest_id, name, map, x, y, facing, sprite, dialogue, active)
SELECT
  'scientist-welcome',
  q.id,
  'Scientist',
  '0-9',
  14,
  13,
  'down',
  'scientist',
  '["Welcome to Emerald Online 3DS - Beta!","Would you like to join our research team?"]'::jsonb,
  true
FROM quests q
WHERE q.slug = 'welcome-to-hoenn-online'
ON CONFLICT (slug) DO NOTHING;
