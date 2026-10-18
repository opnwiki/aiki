-- Durable follow state and per-topic discussion controls for the Fediverse bridge.

ALTER TABLE topics
  DROP CONSTRAINT IF EXISTS topics_kind_check;

ALTER TABLE topics
  ADD CONSTRAINT topics_kind_check
    CHECK (kind IN ('page', 'article', 'question', 'discussion', 'message'));

ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS discussion_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS accept_replies BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS federation_outbound_mode TEXT NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'topics_federation_outbound_mode_check') THEN
    ALTER TABLE topics ADD CONSTRAINT topics_federation_outbound_mode_check
      CHECK (federation_outbound_mode IN ('none', 'auto', 'manual'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS topics_discussion_controls_idx
  ON topics (node_id, discussion_enabled, accept_replies, updated_at DESC);

CREATE TABLE IF NOT EXISTS federation_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_actor_id UUID NOT NULL REFERENCES federation_actors(id) ON DELETE CASCADE,
  remote_actor_uri TEXT NOT NULL,
  follow_activity_uri TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('pending', 'active', 'undone', 'blocked')),
  accept_activity_uri TEXT,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (local_actor_id, remote_actor_uri),
  UNIQUE (follow_activity_uri)
);

CREATE INDEX IF NOT EXISTS federation_follows_remote_idx
  ON federation_follows (remote_actor_uri, state, updated_at DESC);

COMMENT ON TABLE federation_follows IS
  'Inbound ActivityPub Follow relationships for local actors and channels.';
COMMENT ON COLUMN topics.discussion_enabled IS
  'Whether this topic accepts discussion and inbound Fediverse replies.';
COMMENT ON COLUMN topics.accept_replies IS
  'Whether local and remote users may create replies on this topic.';
COMMENT ON COLUMN topics.federation_outbound_mode IS
  'Per-topic outbound policy: none, automatic replies, or manual queueing.';
