-- Community mode publishes at once. Manual mode holds a new page until a person
-- confirms it. A model check is stored on the page, not as a third node mode.

ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS moderation_mode TEXT NOT NULL DEFAULT 'community';

ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_moderation_mode_check;
ALTER TABLE nodes
  ADD CONSTRAINT nodes_moderation_mode_check
  CHECK (moderation_mode IN ('community', 'manual'));

ALTER TABLE topics DROP CONSTRAINT IF EXISTS topics_status_check;
ALTER TABLE topics
  ADD CONSTRAINT topics_status_check
  CHECK (status IN ('published', 'unlisted', 'hidden', 'pending', 'deleted'));

ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS assistant_moderation JSONB;

ALTER TABLE edit_proposals
  ADD COLUMN IF NOT EXISTS author_stance TEXT;

ALTER TABLE edit_proposals DROP CONSTRAINT IF EXISTS edit_proposals_author_stance_check;
ALTER TABLE edit_proposals
  ADD CONSTRAINT edit_proposals_author_stance_check
  CHECK (author_stance IS NULL OR author_stance IN ('agree', 'disagree'));

CREATE TABLE IF NOT EXISTS moderation_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('publish', 'views')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'clear', 'held', 'failed')),
  provider TEXT,
  model TEXT,
  reason TEXT,
  reads_at_check BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS moderation_checks_topic_created_idx
  ON moderation_checks (topic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS topics_pending_created_idx
  ON topics (created_at DESC)
  WHERE status = 'pending';
