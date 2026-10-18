-- Missing short overviews are useful for every published page kind, not only
-- articles. Keep the insert idempotent so it is safe on existing databases.
INSERT INTO content_tasks (node_id, topic_id, base_revision_id, creator_id, task_type, reason, source_locale)
SELECT topic.node_id, topic.id, current.revision_id, topic.author_id, 'update_overview', 'missing_overview', revision.locale
  FROM topics topic
  JOIN topic_current_revisions current ON current.topic_id = topic.id
  JOIN revisions revision ON revision.id = current.revision_id
 WHERE topic.kind IN ('article', 'question', 'discussion')
   AND topic.status IN ('published', 'unlisted', 'hidden')
   AND coalesce(nullif(btrim(topic.summary), ''), nullif(btrim(revision.summary), '')) IS NULL
ON CONFLICT DO NOTHING;
