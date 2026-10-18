-- Backfill article-synthesis tasks for questions that already have enough
-- published answers. Future replies are handled by ensureContentTasks().
WITH inserted AS (
  INSERT INTO content_tasks (
    node_id, topic_id, base_revision_id, creator_id,
    task_type, reason, source_locale
  )
  SELECT topic.node_id, topic.id, current.revision_id, topic.author_id,
         'write_article', 'question_three_answers', revision.locale
    FROM topics topic
    JOIN topic_current_revisions current ON current.topic_id = topic.id
    JOIN revisions revision ON revision.id = current.revision_id
   WHERE topic.kind = 'question'
     AND topic.status IN ('published', 'unlisted', 'hidden')
     AND revision.source_revision_id IS NULL
     AND (SELECT count(*)::int
            FROM replies
           WHERE replies.topic_id = topic.id
             AND replies.status = 'published') >= 3
  ON CONFLICT DO NOTHING
  RETURNING id, creator_id
)
INSERT INTO content_task_events (task_id, actor_id, event_type, details)
SELECT id, creator_id, 'created', jsonb_build_object('automatic', true, 'backfill', true)
  FROM inserted;
