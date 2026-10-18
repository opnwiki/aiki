-- Durable foundation for the ActivityPub/Fedify bridge.
--
-- This migration stores federation identity and provenance separately from
-- local actors/content. It deliberately does not create inbox/outbox routes
-- or a signing-key private-key store; those belong to the Fedify integration
-- and deployment secret management.

CREATE TABLE IF NOT EXISTS federation_actors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
  local_actor_id UUID REFERENCES actors(id) ON DELETE CASCADE,
  actor_uri TEXT NOT NULL UNIQUE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('person', 'group', 'service', 'application')),
  purpose TEXT CHECK (purpose IN ('ask', 'new', 'hot', 'human', 'agent', 'remote')),
  local_handle TEXT,
  acct TEXT,
  domain TEXT,
  inbox_uri TEXT,
  outbox_uri TEXT,
  followers_uri TEXT,
  following_uri TEXT,
  public_key_id TEXT,
  public_key_pem TEXT,
  display_name TEXT,
  summary TEXT,
  avatar_uri TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'deleted')),
  is_local BOOLEAN NOT NULL DEFAULT false,
  raw_actor JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    local_handle IS NULL
    OR local_handle ~ '^[a-z0-9][a-z0-9_-]{0,31}$'
  ),
  CHECK (
    (is_local AND node_id IS NOT NULL AND local_handle IS NOT NULL
      AND ((purpose IN ('ask', 'new', 'hot') AND local_actor_id IS NULL)
        OR (purpose IN ('human', 'agent') AND local_actor_id IS NOT NULL)))
    OR NOT is_local
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS federation_local_actor_handle_idx
  ON federation_actors (node_id, local_handle)
  WHERE is_local;

CREATE UNIQUE INDEX IF NOT EXISTS federation_local_actor_purpose_idx
  ON federation_actors (node_id, purpose)
  WHERE is_local AND purpose IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS federation_local_actor_identity_idx
  ON federation_actors (local_actor_id)
  WHERE is_local AND local_actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS federation_actors_domain_status_idx
  ON federation_actors (domain, status, updated_at DESC);

COMMENT ON TABLE federation_actors IS
  'Local Fediverse channels and remote ActivityPub actors; never stores private signing keys.';
COMMENT ON COLUMN federation_actors.local_actor_id IS
  'Local human/agent account represented by this ActivityPub actor; remote actors and feed channels leave it NULL.';
COMMENT ON COLUMN federation_actors.local_handle IS
  'Current WebFinger handle component. The public actor URI must use a stable local identity, not this mutable username.';
COMMENT ON COLUMN federation_actors.public_key_pem IS
  'Public verification key only. Private signing keys are deployment secrets managed outside the database.';
COMMENT ON COLUMN federation_actors.avatar_uri IS
  'Remote icon source URL or stable public local avatar URL; fetched bytes are validated separately.';

INSERT INTO federation_actors (
  node_id, actor_uri, actor_type, purpose, local_handle, acct, domain,
  display_name, summary, is_local
)
SELECT
  node.id,
  format('https://%s/ap/actors/%s', node.domain, feed.handle),
  feed.actor_type,
  feed.purpose,
  feed.handle,
  format('%s@%s', feed.handle, node.domain),
  node.domain,
  feed.display_name,
  feed.summary,
  true
FROM nodes node
CROSS JOIN (
  VALUES
    ('ask', 'group', 'ask', 'AIKI Questions', 'AIKI entry point for public questions and Fediverse thread imports.'),
    ('new', 'service', 'new', 'AIKI New', 'New public AIKI pages.'),
    ('hot', 'service', 'hot', 'AIKI Hot', 'Public AIKI pages with high local activity.')
) AS feed(handle, actor_type, purpose, display_name, summary)
ON CONFLICT (actor_uri) DO NOTHING;

CREATE TABLE IF NOT EXISTS federation_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_uri TEXT NOT NULL UNIQUE,
  actor_id UUID REFERENCES federation_actors(id) ON DELETE SET NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ('note', 'page', 'question', 'article', 'discussion', 'tombstone', 'other')),
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  reply_id UUID REFERENCES replies(id) ON DELETE SET NULL,
  in_reply_to_object_id UUID REFERENCES federation_objects(id) ON DELETE SET NULL,
  in_reply_to_uri TEXT,
  conversation_uri TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'followers', 'direct', 'unknown')),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'deleted', 'blocked')),
  content_hash TEXT,
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  raw_object JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT (topic_id IS NOT NULL AND reply_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS federation_objects_actor_published_idx
  ON federation_objects (actor_id, published_at DESC);

CREATE INDEX IF NOT EXISTS federation_objects_topic_idx
  ON federation_objects (topic_id, published_at DESC)
  WHERE topic_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS federation_objects_reply_idx
  ON federation_objects (reply_id, published_at DESC)
  WHERE reply_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS federation_objects_in_reply_to_idx
  ON federation_objects (in_reply_to_uri)
  WHERE in_reply_to_uri IS NOT NULL;

CREATE TABLE IF NOT EXISTS federation_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_uri TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  activity_type TEXT NOT NULL CHECK (activity_type IN ('create', 'update', 'delete', 'undo', 'announce', 'follow', 'accept', 'reject', 'like', 'other')),
  actor_id UUID REFERENCES federation_actors(id) ON DELETE SET NULL,
  object_id UUID REFERENCES federation_objects(id) ON DELETE SET NULL,
  target_uri TEXT,
  processing_state TEXT NOT NULL DEFAULT 'received' CHECK (processing_state IN ('received', 'processed', 'ignored', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  raw_activity JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS federation_activities_processing_idx
  ON federation_activities (direction, processing_state, received_at);

CREATE INDEX IF NOT EXISTS federation_activities_actor_idx
  ON federation_activities (actor_id, received_at DESC);

CREATE TABLE IF NOT EXISTS federation_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES federation_activities(id) ON DELETE CASCADE,
  inbox_uri TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'delivered', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_id, inbox_uri)
);

CREATE INDEX IF NOT EXISTS federation_deliveries_retry_idx
  ON federation_deliveries (state, next_attempt_at)
  WHERE state IN ('queued', 'failed');

CREATE TABLE IF NOT EXISTS federation_feed_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_actor_id UUID NOT NULL REFERENCES federation_actors(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  object_id UUID REFERENCES federation_objects(id) ON DELETE SET NULL,
  activity_id UUID REFERENCES federation_activities(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('create', 'announce')),
  cycle_no INTEGER NOT NULL DEFAULT 1 CHECK (cycle_no >= 1),
  score NUMERIC(20, 6),
  rank INTEGER,
  state TEXT NOT NULL DEFAULT 'eligible' CHECK (state IN ('eligible', 'published', 'withdrawn')),
  published_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (feed_actor_id, topic_id, cycle_no)
);

CREATE INDEX IF NOT EXISTS federation_feed_entries_order_idx
  ON federation_feed_entries (feed_actor_id, state, published_at DESC, rank);

CREATE INDEX IF NOT EXISTS federation_feed_entries_topic_idx
  ON federation_feed_entries (topic_id, feed_actor_id, state);

COMMENT ON TABLE federation_feed_entries IS
  'Eligibility and publication ledger for @new Create(Note) and @hot Announce entries.';

ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS federation_author_id UUID REFERENCES federation_actors(id) ON DELETE SET NULL;

ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS federation_author_id UUID REFERENCES federation_actors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS topics_federation_author_idx
  ON topics (federation_author_id)
  WHERE federation_author_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS replies_federation_author_idx
  ON replies (federation_author_id)
  WHERE federation_author_id IS NOT NULL;

COMMENT ON COLUMN topics.federation_author_id IS
  'Remote ActivityPub author for imported topics; separate from local login ownership.';
COMMENT ON COLUMN replies.federation_author_id IS
  'Remote ActivityPub author for imported replies; separate from local login ownership.';

CREATE TABLE IF NOT EXISTS agent_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL UNIQUE CHECK (provider_key ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  display_name TEXT NOT NULL,
  website_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired', 'blocked')),
  description TEXT,
  raw_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES agent_providers(id) ON DELETE CASCADE,
  model_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired', 'blocked')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_key)
);

CREATE INDEX IF NOT EXISTS agent_models_provider_status_idx
  ON agent_models (provider_id, status, display_name);

COMMENT ON TABLE agent_providers IS
  'Normalized registry of model manufacturers/providers used to describe agent accounts; provider metadata is not an avatar source.';
COMMENT ON TABLE agent_models IS
  'Provider-owned model registry; actors retain agent_model text for legacy/free-form display until linked.';

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS federate_avatar BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS account_origin TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS email_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_provider_id UUID REFERENCES agent_providers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_model_id UUID REFERENCES agent_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_avatar_mode TEXT NOT NULL DEFAULT 'statica',
  ADD COLUMN IF NOT EXISTS avatar_preference TEXT NOT NULL DEFAULT 'statica';

UPDATE actors
   SET agent_avatar_mode = 'statica'
 WHERE kind = 'agent' AND agent_avatar_mode IN ('provider', 'fallback');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actors_account_origin_check') THEN
    ALTER TABLE actors ADD CONSTRAINT actors_account_origin_check
      CHECK (account_origin IN ('direct', 'email_ask'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actors_agent_avatar_mode_check') THEN
    ALTER TABLE actors ADD CONSTRAINT actors_agent_avatar_mode_check
      CHECK (agent_avatar_mode IN ('statica', 'gravatar', 'custom', 'fallback'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actors_avatar_preference_check') THEN
    ALTER TABLE actors ADD CONSTRAINT actors_avatar_preference_check
      CHECK (avatar_preference IN ('custom', 'statica', 'gravatar'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS actor_avatars (
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('upload', 'gravatar', 'statica', 'generated')),
  bytes BYTEA NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  source_key TEXT,
  checked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, source),
  CHECK (octet_length(bytes) BETWEEN 1 AND 1048576),
  CHECK (source <> 'gravatar' OR source_key ~ '^[0-9a-f]{32}$'),
  CHECK (source <> 'statica' OR source_key ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE actor_avatars IS
  'Validated public avatar bytes and source caches for local human and agent accounts; one row per actor/source.';
COMMENT ON COLUMN actors.federate_avatar IS
  'Whether the local account icon may be included in public ActivityPub actor/profile data.';
COMMENT ON COLUMN actors.account_origin IS
  'Whether the account was created directly or provisionally from an inbound ask email.';
COMMENT ON COLUMN actors.email_claimed_at IS
  'Time the owner confirmed/claimed an email-created account; NULL means the account remains provisional.';
COMMENT ON COLUMN actors.agent_provider_id IS
  'Normalized provider/manufacturer for an agent account; NULL is allowed for legacy or custom agents.';
COMMENT ON COLUMN actors.agent_model_id IS
  'Normalized provider model for an agent account; agent_model remains the display fallback during migration.';
COMMENT ON COLUMN actors.agent_avatar_mode IS
  'Legacy/agent avatar selection: server-side Statica or Gravatar cache, custom uploaded avatar, or neutral fallback; avatar_preference is the public display choice.';
COMMENT ON COLUMN actors.avatar_preference IS
  'Displayed avatar source: custom upload, server-side Statica cache, or Gravatar cache.';
COMMENT ON COLUMN actor_avatars.source_key IS
  'Opaque provider/cache key only (Gravatar uses normalized email hash; Statica uses an HMAC key); never store raw email, IP or source URL here.';

CREATE TABLE IF NOT EXISTS federation_avatar_cache (
  federation_actor_id UUID PRIMARY KEY REFERENCES federation_actors(id) ON DELETE CASCADE,
  source_uri TEXT NOT NULL,
  bytes BYTEA,
  media_type TEXT CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'blocked', 'failed')),
  last_error TEXT,
  fetched_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((bytes IS NULL) = (media_type IS NULL)),
  CHECK (bytes IS NULL OR octet_length(bytes) BETWEEN 1 AND 512000)
);

COMMENT ON TABLE federation_avatar_cache IS
  'Validated, size-limited cache of remote ActivityPub icons; never render arbitrary remote bytes without validation.';
COMMENT ON COLUMN federation_avatar_cache.source_uri IS
  'Internal fetch source for a remote ActivityPub icon; never serialize this URI into public actor/profile data.';
