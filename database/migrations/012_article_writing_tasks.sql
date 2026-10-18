-- Neron-backed article-order execution plus a public, claimable writing fallback queue.
-- Assessment IP and full Statica payload remain private and immutable in migration 011.
ALTER TABLE article_order_assessments
  ADD COLUMN IF NOT EXISTS search_context JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'article_order_assessments_context_array_check'
       AND conrelid = 'article_order_assessments'::regclass
  ) THEN
    ALTER TABLE article_order_assessments ADD CONSTRAINT article_order_assessments_context_array_check
      CHECK (jsonb_typeof(search_context) = 'array');
  END IF;
END $$;

ALTER TABLE article_order_submissions
  ADD COLUMN IF NOT EXISTS execution_state TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS neron_task_id TEXT,
  ADD COLUMN IF NOT EXISTS executor_error_code TEXT,
  ADD COLUMN IF NOT EXISTS executor_lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS executor_next_poll_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS executor_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE article_order_submissions
  DROP CONSTRAINT IF EXISTS article_order_submissions_status_check;

ALTER TABLE article_order_submissions
  DROP CONSTRAINT IF EXISTS article_order_submissions_execution_state_check,
  DROP CONSTRAINT IF EXISTS article_order_submissions_neron_task_id_check,
  DROP CONSTRAINT IF EXISTS article_order_submissions_executor_attempts_check;

ALTER TABLE article_order_submissions
  ADD CONSTRAINT article_order_submissions_status_check
    CHECK (status IN ('queued', 'running', 'draft_ready', 'succeeded', 'failed')),
  ADD CONSTRAINT article_order_submissions_execution_state_check
    CHECK (execution_state IN ('pending', 'starting', 'submitted', 'community', 'draft_ready', 'failed')),
  ADD CONSTRAINT article_order_submissions_neron_task_id_check
    CHECK (neron_task_id IS NULL OR length(neron_task_id) BETWEEN 1 AND 160),
  ADD CONSTRAINT article_order_submissions_executor_attempts_check
    CHECK (executor_attempts >= 0);

-- Existing orders were already queued for manual fulfillment; never hand them to the new executor.
UPDATE article_order_submissions
   SET execution_state = CASE status
     WHEN 'succeeded' THEN 'draft_ready'
     WHEN 'failed' THEN 'failed'
     ELSE 'community'
   END
 WHERE execution_state = 'pending';

CREATE INDEX IF NOT EXISTS article_order_executor_pending_idx
  ON article_order_submissions (executor_lease_until, created_at)
  WHERE execution_state IN ('pending', 'starting');
CREATE INDEX IF NOT EXISTS article_order_executor_poll_idx
  ON article_order_submissions (executor_next_poll_at)
  WHERE execution_state = 'submitted';

CREATE TABLE IF NOT EXISTS article_writing_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES article_order_submissions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'submitted', 'accepted', 'closed')),
  claimed_by UUID REFERENCES actors(id) ON DELETE SET NULL,
  claim_actor_label TEXT,
  claim_expires_at TIMESTAMPTZ,
  current_submission_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'claimed' AND claimed_by IS NOT NULL AND claim_expires_at IS NOT NULL)
      OR (status <> 'claimed' AND claim_expires_at IS NULL)),
  CHECK ((status = 'submitted' AND current_submission_id IS NOT NULL)
      OR (status IN ('open', 'claimed') AND current_submission_id IS NULL)
      OR status IN ('accepted', 'closed'))
);

CREATE TABLE IF NOT EXISTS article_writing_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES article_writing_tasks(id) ON DELETE RESTRICT,
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  submitted_by UUID REFERENCES actors(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('article', 'question', 'discussion')),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 8 AND 180),
  body_markdown TEXT NOT NULL CHECK (length(btrim(body_markdown)) BETWEEN 20 AND 40000),
  sources JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
  authorship_mode TEXT,
  model_name TEXT,
  human_contribution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, revision_no),
  CHECK ((kind = 'article' AND jsonb_array_length(sources) BETWEEN 1 AND 20
          AND authorship_mode = 'ai_generated_unreviewed'
          AND model_name IS NOT NULL AND length(btrim(model_name)) BETWEEN 1 AND 160
          AND human_contribution IS NULL)
      OR (kind <> 'article' AND jsonb_array_length(sources) <= 1
          AND authorship_mode IS NULL AND model_name IS NULL AND human_contribution IS NULL))
);

ALTER TABLE article_writing_tasks
  ADD CONSTRAINT article_writing_tasks_current_submission_fk
  FOREIGN KEY (current_submission_id) REFERENCES article_writing_submissions(id) ON DELETE RESTRICT;

-- Convert the original durable manual queue to claimable community tasks.
INSERT INTO article_writing_tasks (order_id, status)
SELECT id, 'open' FROM article_order_submissions WHERE execution_state = 'community'
ON CONFLICT (order_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS article_writing_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES article_writing_tasks(id) ON DELETE RESTRICT,
  submission_id UUID NOT NULL REFERENCES article_writing_submissions(id) ON DELETE RESTRICT,
  reviewer_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  comment TEXT NOT NULL CHECK (length(btrim(comment)) BETWEEN 8 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_article_writing_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'article writing submissions and reviews are immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'article_writing_record_immutable';
END;
$$;

DROP TRIGGER IF EXISTS article_writing_submission_immutable ON article_writing_submissions;
CREATE TRIGGER article_writing_submission_immutable
  BEFORE UPDATE OR DELETE ON article_writing_submissions
  FOR EACH ROW EXECUTE FUNCTION prevent_article_writing_record_mutation();
DROP TRIGGER IF EXISTS article_writing_review_immutable ON article_writing_reviews;
CREATE TRIGGER article_writing_review_immutable
  BEFORE UPDATE OR DELETE ON article_writing_reviews
  FOR EACH ROW EXECUTE FUNCTION prevent_article_writing_record_mutation();

CREATE INDEX IF NOT EXISTS article_writing_tasks_open_idx
  ON article_writing_tasks (status, created_at)
  WHERE status IN ('open', 'claimed');
CREATE INDEX IF NOT EXISTS article_writing_submissions_task_idx
  ON article_writing_submissions (task_id, revision_no DESC);
