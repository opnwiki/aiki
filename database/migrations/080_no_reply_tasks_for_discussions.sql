-- Keep new questions and discussions visible in the reply queue while they have
-- no published response. The expression-based idempotency index makes this safe
-- alongside the original question backfill in migration 065.
INSERT INTO content_tasks (
  node_id, topic_id, base_revision_id, creator_id,
  task_type, reason, source_locale
)
SELECT topic.node_id, topic.id, current.revision_id, topic.author_id,
       'answer_question',
       CASE WHEN topic.kind = 'discussion' THEN 'no_reply' ELSE 'no_answer' END,
       revision.locale
  FROM topics topic
  JOIN topic_current_revisions current ON current.topic_id = topic.id
  JOIN revisions revision ON revision.id = current.revision_id
 WHERE topic.kind IN ('question', 'discussion')
   AND topic.status IN ('published', 'unlisted', 'hidden')
   AND NOT EXISTS (
     SELECT 1
       FROM replies reply
      WHERE reply.topic_id = topic.id
        AND reply.status = 'published'
   )
ON CONFLICT DO NOTHING;
