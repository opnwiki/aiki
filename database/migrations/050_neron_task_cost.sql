-- Retain the provider-reported cost for every Neron task without assuming a
-- currency, unit, or numeric shape that may change between provider versions.
ALTER TABLE article_order_submissions
  ADD COLUMN IF NOT EXISTS provider_cost JSONB;

ALTER TABLE writing_task_agent_runs
  ADD COLUMN IF NOT EXISTS provider_cost JSONB;

COMMENT ON COLUMN article_order_submissions.provider_cost IS
  'Provider-reported Neron task cost, retained as the bounded JSON value returned by the provider.';

COMMENT ON COLUMN writing_task_agent_runs.provider_cost IS
  'Provider-reported Neron task cost, retained as the bounded JSON value returned by the provider.';
