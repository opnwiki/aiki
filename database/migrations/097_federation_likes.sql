-- A like on Mastodon (or any ActivityPub server) for one of our posts counts
-- as an upvote for the page or reply here. One like per remote person and
-- target; Undo removes it.
CREATE TABLE IF NOT EXISTS federation_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_uri TEXT NOT NULL UNIQUE,
  remote_actor_id UUID NOT NULL REFERENCES federation_actors(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('topic', 'reply')),
  target_id UUID NOT NULL,
  object_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (remote_actor_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS federation_likes_target_idx ON federation_likes (target_type, target_id);

-- Scores read local votes and Fediverse likes together.
CREATE OR REPLACE VIEW all_votes AS
  SELECT target_type, target_id, value, created_at FROM votes
  UNION ALL
  SELECT target_type, target_id, 1::smallint AS value, created_at FROM federation_likes;

COMMENT ON TABLE federation_likes IS 'Likes from Fediverse people on pages and replies; counted as upvotes through all_votes.';
