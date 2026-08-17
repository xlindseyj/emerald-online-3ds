CREATE TABLE IF NOT EXISTS teleport_destinations (
  id uuid PRIMARY KEY,
  created_by uuid REFERENCES identities(id) ON DELETE SET NULL,
  name text NOT NULL,
  map_group integer NOT NULL CHECK (map_group BETWEEN 0 AND 255),
  map_num integer NOT NULL CHECK (map_num BETWEEN 0 AND 255),
  x integer NOT NULL CHECK (x BETWEEN 0 AND 4095),
  y integer NOT NULL CHECK (y BETWEEN 0 AND 4095),
  facing text NOT NULL CHECK (facing IN ('up','down','left','right')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teleport_destinations_creator_idx ON teleport_destinations(created_by);
