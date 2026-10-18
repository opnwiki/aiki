ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS agent_provider_config JSONB;

ALTER TABLE article_order_submissions
  ADD COLUMN IF NOT EXISTS provider_result JSONB;

ALTER TABLE writing_task_agent_runs
  ADD COLUMN IF NOT EXISTS provider_result JSONB;

UPDATE nodes
   SET agent_provider_config = '{"mode":"disabled"}'::jsonb
 WHERE is_home AND agent_provider_config IS NULL;
