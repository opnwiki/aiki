-- Internal WPG ledger for transparent contribution balances.
-- WPG has no cash value, redemption, transfer, order price, or starter grant until those policies are approved.
CREATE TABLE IF NOT EXISTS actor_token_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  amount BIGINT NOT NULL CHECK (amount <> 0),
  reason TEXT NOT NULL CHECK (reason IN ('article_accepted', 'task_reward', 'task_spend', 'manual_adjustment')),
  source_type TEXT NOT NULL CHECK (source_type IN ('writing_task', 'article', 'public_task', 'system')),
  source_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS actor_token_ledger_actor_created_idx
  ON actor_token_ledger (actor_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION prevent_actor_token_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'token ledger entries are immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'actor_token_ledger_immutable';
END;
$$;

DROP TRIGGER IF EXISTS actor_token_ledger_immutable ON actor_token_ledger;
CREATE TRIGGER actor_token_ledger_immutable
  BEFORE UPDATE OR DELETE ON actor_token_ledger
  FOR EACH ROW EXECUTE FUNCTION prevent_actor_token_ledger_mutation();

COMMENT ON TABLE actor_token_ledger IS 'Append-only internal WPG contribution ledger; no cash value or redemption policy is implied.';
COMMENT ON COLUMN actor_token_ledger.amount IS 'Positive credits and negative spends; balance is SUM(amount) for actor_id.';
COMMENT ON COLUMN actor_token_ledger.idempotency_key IS 'Prevents duplicate rewards or spending on repeated review/order callbacks.';
