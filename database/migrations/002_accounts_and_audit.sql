ALTER TABLE nodes ADD COLUMN IF NOT EXISTS is_home BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE actors ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE actors ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE actors ADD COLUMN IF NOT EXISTS password_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actors_role_check') THEN
    ALTER TABLE actors ADD CONSTRAINT actors_role_check CHECK (role IN ('owner', 'admin', 'moderator', 'member'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actors_account_status_check') THEN
    ALTER TABLE actors ADD CONSTRAINT actors_account_status_check CHECK (account_status IN ('active', 'suspended', 'deleted'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS nodes_one_home_idx ON nodes (is_home) WHERE is_home;
CREATE UNIQUE INDEX IF NOT EXISTS actors_email_ci_unique_idx ON actors (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS actors_status_created_idx ON actors (account_status, created_at DESC);

CREATE TABLE IF NOT EXISTS human_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS human_sessions_actor_expiry_idx ON human_sessions (actor_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS human_sessions_active_expiry_idx ON human_sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS actor_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS actor_audit_created_idx ON actor_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS actor_audit_actor_created_idx ON actor_audit_log (actor_id, created_at DESC);

-- Additive fixture upgrade: keep the starter author/system actor non-privileged.
UPDATE nodes SET is_home = true WHERE id = '00000000-0000-4000-8000-000000000002' AND NOT EXISTS (SELECT 1 FROM nodes WHERE is_home);
