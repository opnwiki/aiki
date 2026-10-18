-- Directory of the central instance and the additional nodes that find each other through it.
ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS mesh_hub_url text;

CREATE TABLE IF NOT EXISTS mesh_nodes (
  base_url text PRIMARY KEY,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('hub', 'peer')),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
