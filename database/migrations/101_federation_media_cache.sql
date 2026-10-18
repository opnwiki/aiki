-- Pictures attached to Fediverse posts and replies. They are downloaded once,
-- checked and re-encoded by AIKI and served from /api/federation-media/..., so
-- readers never contact the remote server.
CREATE TABLE IF NOT EXISTS federation_media_cache (
  federation_object_id UUID NOT NULL REFERENCES federation_objects(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL CHECK (position >= 0 AND position < 8),
  source_uri TEXT NOT NULL,
  bytes BYTEA,
  media_type TEXT CHECK (media_type IN ('image/webp')),
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  width INTEGER,
  height INTEGER,
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'failed')),
  last_error TEXT,
  fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (federation_object_id, position),
  CHECK ((bytes IS NULL) = (media_type IS NULL))
);

COMMENT ON COLUMN federation_media_cache.source_uri IS
  'Internal fetch source of a remote attachment; never serialize this URI into public data.';
