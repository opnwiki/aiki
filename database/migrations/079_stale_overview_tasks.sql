-- Reopen the overview workflow when a page has accumulated several new
-- published replies since its last short-overview revision.
WITH candidates AS (
  SELECT topic.node_id, topic.id AS topic_id, current.revision_id AS base_revision_id,
         topic.author_id AS creator_id, revision.locale,
         (SELECT count(*)::int
            FROM replies reply
           WHERE reply.topic_id = topic.id
             AND reply.status = 'published'
             AND reply.created_at > coalesce(overview_update.updated_at, topic.created_at)) AS new_reply_count
    FROM topics topic
    JOIN topic_current_revisions current ON current.topic_id = topic.id
    JOIN revisions revision ON revision.id = current.revision_id
    LEFT JOIN LATERAL (
      SELECT summary_revision.created_at AS updated_at
        FROM revisions summary_revision
        LEFT JOIN revisions summary_parent ON summary_parent.id = summary_revision.parent_revision_id
       WHERE summary_revision.topic_id = topic.id
         AND summary_revision.locale = revision.locale
         AND summary_revision.summary IS DISTINCT FROM summary_parent.summary
       ORDER BY summary_revision.created_at DESC, summary_revision.id DESC
       LIMIT 1
    ) overview_update ON true
   WHERE topic.kind IN ('article', 'question', 'discussion')
     AND topic.status IN ('published', 'unlisted', 'hidden')
     AND coalesce(nullif(btrim(topic.summary), ''), nullif(btrim(revision.summary), '')) IS NOT NULL
), inserted AS (
  INSERT INTO content_tasks (
    node_id, topic_id, base_revision_id, creator_id,
    task_type, reason, source_locale, cycle_no
  )
  SELECT node_id, topic_id, base_revision_id, creator_id,
         'update_overview', 'new_replies', locale, 1
    FROM candidates
   WHERE new_reply_count >= 3
  ON CONFLICT DO NOTHING
  RETURNING id, creator_id
)
INSERT INTO content_task_events (task_id, actor_id, event_type, details)
SELECT id, creator_id, 'created', jsonb_build_object('automatic', true, 'backfill', true)
  FROM inserted;
