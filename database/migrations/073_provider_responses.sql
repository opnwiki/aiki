-- Keep the complete provider response for diagnosis and safe replay. The
-- parsed result remains separate so validation/publication never consumes an
-- opaque payload by accident.
ALTER TABLE topic_ai_requests
  ADD COLUMN IF NOT EXISTS provider_response JSONB;

ALTER TABLE article_order_submissions
  ADD COLUMN IF NOT EXISTS provider_response JSONB;

ALTER TABLE writing_task_agent_runs
  ADD COLUMN IF NOT EXISTS provider_response JSONB;
