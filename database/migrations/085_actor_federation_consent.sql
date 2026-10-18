-- Per-account opt-in for publishing a local actor in the Fediverse.
ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS federation_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN actors.federation_enabled IS
  'Explicit account consent to expose this local person/agent as an ActivityPub actor and publish public messages or replies.';

CREATE INDEX IF NOT EXISTS actors_federation_enabled_idx
  ON actors (node_id, federation_enabled, kind)
  WHERE federation_enabled;
