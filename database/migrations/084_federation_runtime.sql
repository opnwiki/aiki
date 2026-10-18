-- Runtime controls and idempotent import/delivery ledgers for the Fedify bridge.
-- Private signing keys remain deployment secrets (environment JWK or the
-- administrator-created FEDERATION_PRIVATE_KEY_FILE), never database data.

ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS federation_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS federation_mode TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS federation_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS federation_last_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nodes_federation_mode_check') THEN
    ALTER TABLE nodes ADD CONSTRAINT nodes_federation_mode_check
      CHECK (federation_mode IN ('open', 'inbound_only', 'outbound_only', 'paused'));
  END IF;
END $$;

-- The original purpose index allowed only one local human and one local agent
-- per node. Channels are singleton identities; account actors are not.
DROP INDEX IF EXISTS federation_local_actor_purpose_idx;
CREATE UNIQUE INDEX IF NOT EXISTS federation_local_channel_purpose_idx
  ON federation_actors (node_id, purpose)
  WHERE is_local AND purpose IN ('ask', 'new', 'hot');

CREATE TABLE IF NOT EXISTS federation_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  requested_url TEXT NOT NULL,
  canonical_root_uri TEXT,
  source_platform TEXT NOT NULL DEFAULT 'mastodon',
  topic_id UUID,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'complete', 'partial', 'failed', 'paused')),
  total_seen INTEGER NOT NULL DEFAULT 0 CHECK (total_seen >= 0),
  public_imported INTEGER NOT NULL DEFAULT 0 CHECK (public_imported >= 0),
  skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  last_error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  created_by UUID REFERENCES actors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, requested_url)
);

ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS federation_import_id UUID REFERENCES federation_imports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS federation_imports_node_status_idx
  ON federation_imports (node_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS federation_import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES federation_imports(id) ON DELETE CASCADE,
  object_uri TEXT NOT NULL,
  activity_uri TEXT,
  actor_uri TEXT,
  parent_object_uri TEXT,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  reply_id UUID REFERENCES replies(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'unlisted', 'followers', 'direct', 'unknown')),
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'deleted', 'blocked', 'skipped')),
  content_hash TEXT,
  remote_published_at TIMESTAMPTZ,
  raw_object JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (import_id, object_uri)
);

CREATE INDEX IF NOT EXISTS federation_import_items_parent_idx
  ON federation_import_items (import_id, parent_object_uri)
  WHERE parent_object_uri IS NOT NULL;

CREATE INDEX IF NOT EXISTS federation_import_items_reply_idx
  ON federation_import_items (reply_id)
  WHERE reply_id IS NOT NULL;

ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS federation_object_uri TEXT,
  ADD COLUMN IF NOT EXISTS federation_activity_uri TEXT,
  ADD COLUMN IF NOT EXISTS federation_source_url TEXT,
  ADD COLUMN IF NOT EXISTS federation_delivery_state TEXT NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'replies_federation_delivery_state_check') THEN
    ALTER TABLE replies ADD CONSTRAINT replies_federation_delivery_state_check
      CHECK (federation_delivery_state IN ('none', 'queued', 'delivered', 'retry', 'failed', 'paused'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS replies_federation_object_uri_idx
  ON replies (federation_object_uri)
  WHERE federation_object_uri IS NOT NULL;

CREATE TABLE IF NOT EXISTS federation_reply_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reply_id UUID NOT NULL REFERENCES replies(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  target_object_uri TEXT NOT NULL,
  target_actor_uri TEXT,
  target_inbox_uri TEXT,
  activity_uri TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'delivered', 'retry', 'failed', 'paused', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  remote_url TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reply_id, target_object_uri)
);

CREATE INDEX IF NOT EXISTS federation_reply_deliveries_due_idx
  ON federation_reply_deliveries (state, next_attempt_at)
  WHERE state IN ('queued', 'retry');

COMMENT ON COLUMN nodes.federation_enabled IS
  'Instance-level kill switch. Disabling pauses inbox processing, imports and outbound delivery without deleting identity or provenance.';
COMMENT ON COLUMN nodes.federation_mode IS
  'open permits inbound and outbound federation; inbound_only/outbound_only narrow traffic; paused is an operational pause.';
COMMENT ON TABLE federation_imports IS
  'User-requested public Fediverse thread imports with idempotent status and operational counters.';
COMMENT ON TABLE federation_reply_deliveries IS
  'Outbound local reply ledger. Every remote target is durable, retryable and auditable.';
