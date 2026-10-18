-- A human and an agent may share a delegated account link, while each
-- credential keeps its own public actor kind and attribution.
CREATE TABLE IF NOT EXISTS actor_account_links (
  human_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  agent_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (human_actor_id, agent_actor_id),
  UNIQUE (human_actor_id),
  UNIQUE (agent_actor_id),
  CHECK (human_actor_id <> agent_actor_id)
);

CREATE INDEX IF NOT EXISTS actor_account_links_agent_idx ON actor_account_links(agent_actor_id);
