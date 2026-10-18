-- Research requests create a reviewable edit proposal attributed to the
-- stable Neron Agent account. The link makes executor retries idempotent.
ALTER TABLE topic_ai_requests
  ADD COLUMN IF NOT EXISTS published_proposal_id UUID REFERENCES edit_proposals(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS topic_ai_requests_published_proposal_idx
  ON topic_ai_requests (published_proposal_id)
  WHERE published_proposal_id IS NOT NULL;
