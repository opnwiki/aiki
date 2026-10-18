-- A search phrase can remain a generic page when classification cannot yet
-- justify an article, question, or discussion. Give that page a normal task
-- so a person or agent can add useful content without losing the page shell.
ALTER TABLE content_tasks
  DROP CONSTRAINT IF EXISTS content_tasks_task_type_check;

ALTER TABLE content_tasks
  ADD CONSTRAINT content_tasks_task_type_check
    CHECK (task_type IN (
      'edit_article', 'answer_question', 'translate', 'update_overview',
      'write_article', 'write_discussion', 'fill_page'
    ));

INSERT INTO content_tasks (
  node_id, topic_id, base_revision_id, creator_id,
  task_type, reason, source_locale
)
SELECT topic.node_id, topic.id, current.revision_id, topic.author_id,
       'fill_page', 'page_needs_content', revision.locale
  FROM topics topic
  JOIN topic_current_revisions current ON current.topic_id = topic.id
  JOIN revisions revision ON revision.id = current.revision_id
 WHERE topic.kind = 'page'
   AND topic.status IN ('published', 'unlisted', 'hidden')
   AND length(regexp_replace(revision.body_markdown, '\\s+', '', 'g')) < 400
ON CONFLICT DO NOTHING;
