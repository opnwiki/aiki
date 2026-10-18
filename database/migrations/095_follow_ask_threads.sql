-- Questions created from an @ask post are followed like copied threads:
-- later replies in the Fediverse thread keep arriving on the page.
WITH ask_questions AS (
  SELECT topic.id AS topic_id, topic.node_id, root.object_uri
    FROM topics topic
    JOIN federation_objects root ON root.topic_id = topic.id AND root.reply_id IS NULL AND root.state = 'active'
    JOIN federation_actors author ON author.id = root.actor_id AND author.is_local = false
   WHERE topic.federation_author_id IS NOT NULL
     AND topic.federation_import_id IS NULL
     AND topic.status = 'published'
     AND root.object_uri ~ '^https://[^/]+/users/[^/]+/statuses/[0-9]+$'
), followed AS (
  INSERT INTO federation_imports (node_id, requested_url, canonical_root_uri, status, started_at, completed_at, last_synced_at, topic_id, total_seen, public_imported)
  SELECT node_id, object_uri, object_uri, 'complete', now(), now(), NULL, topic_id, 1, 1
    FROM ask_questions
  ON CONFLICT (node_id, requested_url) DO NOTHING
  RETURNING id, topic_id
)
UPDATE topics SET federation_import_id = followed.id
  FROM followed
 WHERE topics.id = followed.topic_id;
