-- Keep the latest provider progress visible to the task owner without exposing
-- the provider response or any prompt/result data.
ALTER TABLE writing_task_agent_runs
  ADD COLUMN IF NOT EXISTS progress_percent SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_stage TEXT,
  ADD COLUMN IF NOT EXISTS progress_message TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'writing_task_agent_runs_progress_percent_check'
       AND conrelid = 'writing_task_agent_runs'::regclass
  ) THEN
    ALTER TABLE writing_task_agent_runs ADD CONSTRAINT writing_task_agent_runs_progress_percent_check
      CHECK (progress_percent BETWEEN 0 AND 100);
  END IF;
END $$;
