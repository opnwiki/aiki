-- Preserve provenance when a task turns a question or discussion into a page.
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS source_topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_revision_id UUID REFERENCES revisions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS topics_source_topic_idx
  ON topics (source_topic_id)
  WHERE source_topic_id IS NOT NULL;

-- Recover provenance for pages created by an earlier accepted write task.
UPDATE topics derived
   SET source_topic_id = task.topic_id,
       source_revision_id = task.base_revision_id
  FROM content_task_solutions solution
  JOIN content_tasks task ON task.id = solution.task_id
 WHERE solution.result_topic_id = derived.id
   AND task.task_type IN ('write_article', 'write_discussion')
   AND task.topic_id IS NOT NULL
   AND derived.source_topic_id IS NULL;

-- Discussions with three or more published replies should enter the same
-- article-synthesis flow as questions. The unique task index keeps this safe
-- to rerun and future replies are handled by ensureContentTasks().
WITH inserted AS (
  INSERT INTO content_tasks (
    node_id, topic_id, base_revision_id, creator_id,
    task_type, reason, source_locale
  )
  SELECT topic.node_id, topic.id, current.revision_id, topic.author_id,
         'write_article', 'discussion_three_answers', revision.locale
    FROM topics topic
    JOIN topic_current_revisions current ON current.topic_id = topic.id
    JOIN revisions revision ON revision.id = current.revision_id
   WHERE topic.kind = 'discussion'
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
