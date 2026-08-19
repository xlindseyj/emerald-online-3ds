-- Phase 3: lightweight player guilds.

CREATE TABLE IF NOT EXISTS guilds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(40) UNIQUE NOT NULL,
  tag varchar(6) UNIQUE NOT NULL,
  leader_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guild_members (
  identity_id uuid PRIMARY KEY REFERENCES identities(id) ON DELETE CASCADE,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('leader','member')),
  joined_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guild_members_guild_idx ON guild_members(guild_id);
