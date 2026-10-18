-- Search article-order intake. Client IP and the full Statica response are retained indefinitely by product requirement.
-- These are sensitive operational records: never expose them in public APIs or application logs.
CREATE TABLE IF NOT EXISTS article_order_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  request_key_hash TEXT NOT NULL UNIQUE CHECK (request_key_hash ~ '^[a-f0-9]{64}$'),
  client_ip INET NOT NULL,
  statica_response JSONB NOT NULL,
  statica_is_clean BOOLEAN NOT NULL,
  query_text TEXT NOT NULL CHECK (length(query_text) BETWEEN 1 AND 160),
  locale TEXT NOT NULL REFERENCES locales(lang),
  outcome TEXT NOT NULL CHECK (outcome IN ('queued', 'rejected_not_clean', 'rejected_daily_limit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS article_order_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL UNIQUE REFERENCES article_order_assessments(id) ON DELETE RESTRICT,
  access_token_hash TEXT NOT NULL CHECK (access_token_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  result_topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  error_code TEXT,
  CHECK ((status = 'succeeded' AND result_topic_id IS NOT NULL AND finished_at IS NOT NULL)
      OR (status <> 'succeeded' AND result_topic_id IS NULL)),
  CHECK (status <> 'running' OR started_at IS NOT NULL),
  CHECK (status NOT IN ('failed', 'succeeded') OR finished_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS article_order_assessments_ip_created_idx
  ON article_order_assessments (client_ip, created_at DESC);
CREATE INDEX IF NOT EXISTS article_order_assessments_actor_created_idx
  ON article_order_assessments (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS article_order_submissions_status_created_idx
  ON article_order_submissions (status, created_at)
  WHERE status IN ('queued', 'running');

CREATE OR REPLACE FUNCTION prevent_article_order_assessment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'article order assessment audit records are immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'article_order_assessment_immutable';
END;
$$;

DROP TRIGGER IF EXISTS article_order_assessment_immutable ON article_order_assessments;
CREATE TRIGGER article_order_assessment_immutable
  BEFORE UPDATE OR DELETE ON article_order_assessments
  FOR EACH ROW EXECUTE FUNCTION prevent_article_order_assessment_mutation();
