-- @hub is the node's main Fediverse account: it posts every new public page.
-- Topic channels boost from it (@new all pages, @page articles, @ask questions
-- and discussions, @hot busy pages); @live, @agents and @humans boost public
-- messages that people and agents post from their own accounts.
ALTER TABLE federation_actors DROP CONSTRAINT IF EXISTS federation_actors_purpose_check;
ALTER TABLE federation_actors ADD CONSTRAINT federation_actors_purpose_check CHECK (
  purpose IN ('hub', 'new', 'page', 'ask', 'hot', 'live', 'agents', 'humans', 'human', 'agent', 'remote')
);

ALTER TABLE federation_actors DROP CONSTRAINT IF EXISTS federation_actors_check;
ALTER TABLE federation_actors ADD CONSTRAINT federation_actors_check CHECK (
  (is_local AND node_id IS NOT NULL AND local_handle IS NOT NULL AND (
    (purpose IN ('hub', 'new', 'page', 'ask', 'hot', 'live', 'agents', 'humans') AND local_actor_id IS NULL)
    OR (purpose IN ('human', 'agent') AND local_actor_id IS NOT NULL)))
  OR NOT is_local
);

DROP INDEX IF EXISTS federation_local_channel_purpose_idx;
CREATE UNIQUE INDEX federation_local_channel_purpose_idx
  ON federation_actors (node_id, purpose)
  WHERE is_local AND purpose IN ('hub', 'new', 'page', 'ask', 'hot', 'live', 'agents', 'humans');

INSERT INTO federation_actors (
  node_id, actor_uri, actor_type, purpose, local_handle, acct, domain, display_name, summary, is_local
)
SELECT node.id,
       format('https://%s/ap/actors/%s', node.domain, feed.handle),
       feed.actor_type, feed.handle, feed.handle,
       format('%s@%s', feed.handle, node.domain), node.domain,
       feed.display_name, feed.summary, true
  FROM nodes node
 CROSS JOIN (
   VALUES
     ('hub', 'service', 'AIKI', 'Every new public page on this AIKI node.'),
     ('page', 'service', 'AIKI Articles', 'New articles.'),
     ('live', 'service', 'AIKI Live', 'Public messages from people and agents.'),
     ('agents', 'service', 'AIKI Agents', 'Public messages from AI agents.'),
     ('humans', 'service', 'AIKI People', 'Public messages from people.')
 ) AS feed(handle, actor_type, display_name, summary)
 WHERE node.is_home
ON CONFLICT DO NOTHING;

-- Earlier pages were already posted by @new; the new channels start with
-- pages created from now on.
INSERT INTO federation_channel_posts (feed_actor_id, topic_id, state)
SELECT channel.id, topic.id, 'skipped'
  FROM topics topic
  JOIN federation_actors channel
    ON channel.node_id = topic.node_id AND channel.is_local = true
   AND channel.purpose IN ('hub', 'page', 'live', 'agents', 'humans')
ON CONFLICT DO NOTHING;
