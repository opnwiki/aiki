-- Discussion answers prepared by the on-page AI assistant are published by a
-- stable, clearly identified agent account. The link makes completion
-- idempotent if the executor is restarted while a provider task is done.
ALTER TABLE topic_ai_requests
  ADD COLUMN IF NOT EXISTS published_reply_id UUID REFERENCES replies(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS topic_ai_requests_published_reply_idx
  ON topic_ai_requests (published_reply_id)
  WHERE published_reply_id IS NOT NULL;
