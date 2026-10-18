-- On-page AI assistance is durable, reviewable, and never publishes directly.
CREATE TABLE IF NOT EXISTS topic_ai_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK (request_type IN ('supplement', 'research', 'discussion_reply', 'question_answer')),
  locale TEXT NOT NULL,
  base_revision_id UUID NOT NULL REFERENCES revisions(id) ON DELETE RESTRICT,
  instruction TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'submitted', 'completed', 'failed', 'cancelled')),
  provider_task_id TEXT,
  provider_result JSONB,
  result JSONB,
  provider_cost JSONB,
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  progress_stage TEXT,
  progress_message TEXT,
  error_code TEXT,
  error_message TEXT,
  executor_attempts INTEGER NOT NULL DEFAULT 0 CHECK (executor_attempts >= 0),
  executor_lease_until TIMESTAMPTZ,
  executor_next_poll_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CHECK (provider_task_id IS NULL OR length(btrim(provider_task_id)) BETWEEN 1 AND 160),
  CHECK (result IS NULL OR jsonb_typeof(result) = 'object')
);

CREATE INDEX IF NOT EXISTS topic_ai_requests_executor_idx
  ON topic_ai_requests (executor_next_poll_at, created_at)
  WHERE status IN ('queued', 'submitted');

CREATE INDEX IF NOT EXISTS topic_ai_requests_requester_idx
  ON topic_ai_requests (requester_id, created_at DESC);

CREATE INDEX IF NOT EXISTS topic_ai_requests_topic_idx
  ON topic_ai_requests (topic_id, created_at DESC);
