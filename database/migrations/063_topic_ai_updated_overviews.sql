-- An overview request updates the page overview automatically in a new
-- immutable revision while keeping the article body unchanged.
ALTER TABLE topic_ai_requests
  DROP CONSTRAINT IF EXISTS topic_ai_requests_request_type_check;

ALTER TABLE topic_ai_requests
  ADD CONSTRAINT topic_ai_requests_request_type_check
  CHECK (request_type IN ('supplement', 'research', 'overview', 'discussion_reply', 'question_answer'));

ALTER TABLE topic_ai_requests
  ADD COLUMN IF NOT EXISTS updated_overview_revision_id UUID REFERENCES revisions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS topic_ai_requests_updated_overview_idx
  ON topic_ai_requests (updated_overview_revision_id)
  WHERE updated_overview_revision_id IS NOT NULL;
