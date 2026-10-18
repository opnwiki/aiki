-- An offer to hand a published page to another person on this node.
-- The current author stays until the invited account accepts.

CREATE TABLE IF NOT EXISTS page_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  from_actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  to_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  offered_by_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'withdrawn')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by_actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_by_actor_id IS NULL)
    OR (status IN ('accepted', 'declined', 'cancelled', 'withdrawn') AND decided_at IS NOT NULL AND decided_by_actor_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS page_transfers_one_pending_idx
  ON page_transfers (topic_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS page_transfers_topic_created_idx
  ON page_transfers (topic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS page_transfers_inbox_idx
  ON page_transfers (to_actor_id, created_at DESC)
  WHERE status = 'pending';
