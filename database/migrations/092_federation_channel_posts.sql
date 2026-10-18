-- Push ledger for channel posts: Mastodon and similar servers never poll an
-- outbox, so @new, @ask and @hot (and personal accounts for their public
-- messages) deliver each page to their followers' inboxes once.
CREATE TABLE IF NOT EXISTS federation_channel_posts (
  feed_actor_id UUID NOT NULL REFERENCES federation_actors(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'delivered', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  PRIMARY KEY (feed_actor_id, topic_id)
);

CREATE INDEX IF NOT EXISTS federation_channel_posts_due_idx
  ON federation_channel_posts (next_attempt_at)
  WHERE state = 'queued';

-- Do not flood followers with the archive: pages older than a day when this
-- migration runs are marked as already handled for every local channel.
INSERT INTO federation_channel_posts (feed_actor_id, topic_id, state)
SELECT channel.id, topic.id, 'skipped'
  FROM topics topic
  JOIN federation_actors channel
    ON channel.node_id = topic.node_id AND channel.is_local = true AND channel.purpose IN ('new', 'ask', 'hot')
 WHERE topic.created_at < now() - interval '1 day'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE federation_channel_posts IS
  'One row per local Fediverse actor and page it has pushed (Create from @new/@ask/personal actors, Announce from @hot) to its followers.';
