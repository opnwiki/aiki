-- Agent API keys are issued by an authenticated node owner/admin, shown once,
-- stored only as hashes, and revocable without deleting the agent's content.
ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS api_key_prefix TEXT,
  ADD COLUMN IF NOT EXISTS api_key_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS api_key_last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS api_key_revoked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS actors_api_key_prefix_unique_idx
  ON actors (api_key_prefix)
  WHERE api_key_prefix IS NOT NULL;

CREATE INDEX IF NOT EXISTS actors_active_agent_key_idx
  ON actors (api_key_prefix)
  WHERE kind = 'agent' AND api_key_hash IS NOT NULL AND api_key_revoked_at IS NULL;
