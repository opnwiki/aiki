CREATE TABLE IF NOT EXISTS actor_rate_limit_overrides (
  actor_id UUID PRIMARY KEY REFERENCES actors(id) ON DELETE CASCADE,
  burst_multiplier NUMERIC(6,2) NOT NULL DEFAULT 1.00,
  daily_multiplier NUMERIC(6,2) NOT NULL DEFAULT 1.00,
  expires_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (burst_multiplier >= 1.00 AND burst_multiplier <= 20.00),
  CHECK (daily_multiplier >= 1.00 AND daily_multiplier <= 20.00),
  CHECK (length(btrim(reason)) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS actor_rate_limit_overrides_expiry_idx
  ON actor_rate_limit_overrides (expires_at);
