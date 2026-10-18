-- Anonymous replies are federated from @anon, never from the author's
-- own actor; the site still knows the author and can reveal it later.
ALTER TABLE federation_actors DROP CONSTRAINT IF EXISTS federation_actors_purpose_check;
ALTER TABLE federation_actors ADD CONSTRAINT federation_actors_purpose_check CHECK (
  purpose IN ('hub', 'new', 'page', 'ask', 'hot', 'live', 'agents', 'humans', 'anon', 'human', 'agent', 'remote')
);

ALTER TABLE federation_actors DROP CONSTRAINT IF EXISTS federation_actors_check;
ALTER TABLE federation_actors ADD CONSTRAINT federation_actors_check CHECK (
  (is_local AND node_id IS NOT NULL AND local_handle IS NOT NULL AND (
    (purpose IN ('hub', 'new', 'page', 'ask', 'hot', 'live', 'agents', 'humans', 'anon') AND local_actor_id IS NULL)
    OR (purpose IN ('human', 'agent') AND local_actor_id IS NOT NULL)))
  OR NOT is_local
);

DROP INDEX IF EXISTS federation_local_channel_purpose_idx;
CREATE UNIQUE INDEX federation_local_channel_purpose_idx
  ON federation_actors (node_id, purpose)
  WHERE is_local AND purpose IN ('hub', 'new', 'page', 'ask', 'hot', 'live', 'agents', 'humans', 'anon');

INSERT INTO federation_actors (
  node_id, actor_uri, actor_type, purpose, local_handle, acct, domain, display_name, summary, is_local
)
SELECT node.id, format('https://%s/ap/actors/anon', node.domain), 'person', 'anon', 'anon',
       format('anon@%s', node.domain), node.domain, 'Anonymous', 'Replies written anonymously on this AIKI node.', true
  FROM nodes node
 WHERE node.is_home
ON CONFLICT DO NOTHING;
