-- Idempotent one-WPG Neron Agent execution and publication.
ALTER TABLE actor_token_ledger
  DROP CONSTRAINT actor_token_ledger_reason_check,
  DROP CONSTRAINT actor_token_ledger_source_type_check;

ALTER TABLE actor_token_ledger
  ADD CONSTRAINT actor_token_ledger_reason_check
    CHECK (reason IN ('article_accepted', 'task_reward', 'task_spend', 'agent_run_charge', 'agent_run_refund', 'manual_adjustment')),
  ADD CONSTRAINT actor_token_ledger_source_type_check
    CHECK (source_type IN ('writing_task', 'article', 'public_task', 'agent_run', 'system'));

CREATE TABLE writing_task_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES article_writing_tasks(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 16 AND 200),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'submitted', 'completed', 'failed')),
  neron_task_id TEXT UNIQUE,
  executor_attempts INTEGER NOT NULL DEFAULT 0 CHECK (executor_attempts >= 0),
  executor_lease_until TIMESTAMPTZ,
  executor_next_poll_at TIMESTAMPTZ,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CHECK ((status = 'submitted' AND neron_task_id IS NOT NULL)
      OR (status = 'queued' AND neron_task_id IS NULL)
      OR (status = 'completed' AND neron_task_id IS NOT NULL)
      OR (status = 'failed'))
);
CREATE INDEX writing_task_agent_runs_actor_created_idx
  ON writing_task_agent_runs (actor_id, created_at DESC);


CREATE UNIQUE INDEX writing_task_agent_runs_one_active_per_task
  ON writing_task_agent_runs (task_id)
  WHERE status IN ('queued', 'submitted');

CREATE INDEX writing_task_agent_runs_due_idx
  ON writing_task_agent_runs (executor_next_poll_at, executor_lease_until)
  WHERE status IN ('queued', 'submitted');

ALTER TABLE article_writing_tasks
  ADD COLUMN IF NOT EXISTS automation_lease_until TIMESTAMPTZ;

CREATE INDEX writing_task_automation_lease_idx
  ON article_writing_tasks (automation_lease_until)
  WHERE status = 'claimed';

COMMENT ON TABLE writing_task_agent_runs IS 'Audit of explicit user-triggered one-WPG Neron execution and automatic publication; failed runs are refunded. Neron task results stay server-side until validated.';
COMMENT ON COLUMN article_writing_tasks.automation_lease_until IS 'Prevents simultaneous manual edits/claims while a paid Neron run is in progress.';
