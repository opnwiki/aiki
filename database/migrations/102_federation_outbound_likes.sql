-- An upvote here on a page or reply copied from the Fediverse is sent to its
-- author's server as a Like from the voter's own actor; removing the upvote
-- sends Undo. One live Like per local actor and remote post.
CREATE TABLE IF NOT EXISTS federation_outbound_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_uri TEXT NOT NULL UNIQUE,
  local_actor_id UUID NOT NULL REFERENCES federation_actors(id) ON DELETE CASCADE,
  object_uri TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('topic', 'reply')),
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS federation_outbound_likes_live_idx
  ON federation_outbound_likes (local_actor_id, object_uri) WHERE undone_at IS NULL;

COMMENT ON TABLE federation_outbound_likes IS 'Likes sent to the Fediverse for local upvotes on copied remote posts; undone_at is set when the upvote is removed.';
