-- Public access and usefulness to society are separate assessments. NULL means
-- not assessed, and must never authorize automatic article synthesis.
ALTER TABLE topics
  ADD COLUMN public_usefulness_score NUMERIC(5, 2),
  ADD COLUMN public_usefulness_reason TEXT,
  ADD CONSTRAINT topics_public_usefulness_score_check
    CHECK (public_usefulness_score BETWEEN 0.00 AND 100.00);

-- A changed topic needs a new assessment. Overview-only updates and machine
-- translations do not change the subject or invalidate the original score.
CREATE FUNCTION invalidate_topic_public_usefulness() RETURNS trigger AS $$
BEGIN
  IF NEW.revision_id IS DISTINCT FROM OLD.revision_id AND EXISTS (
    SELECT 1
      FROM revisions previous_revision, revisions next_revision
     WHERE previous_revision.id = OLD.revision_id AND next_revision.id = NEW.revision_id
       AND next_revision.source_revision_id IS NULL
       AND (next_revision.title IS DISTINCT FROM previous_revision.title
         OR next_revision.body_markdown IS DISTINCT FROM previous_revision.body_markdown)
  ) THEN
    UPDATE topics
       SET public_usefulness_score = NULL, public_usefulness_reason = NULL
     WHERE id = NEW.topic_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER topic_public_usefulness_invalidated
  AFTER UPDATE OF revision_id ON topic_current_revisions
  FOR EACH ROW EXECUTE FUNCTION invalidate_topic_public_usefulness();

-- Older synthesis tasks were created solely from reply counts. Keep their
-- work for review, but stop automatic publication until they are assessed.
WITH paused AS (
  UPDATE content_tasks
     SET auto_publish_allowed = false,
         status = CASE WHEN status IN ('submitted', 'under_review') THEN 'under_review' ELSE status END,
         updated_at = now()
   WHERE task_type = 'write_article'
     AND reason IN ('question_three_answers', 'discussion_three_answers')
     AND status <> 'resolved'
     AND auto_publish_allowed = true
  RETURNING id
)
INSERT INTO content_task_events (task_id, event_type, details)
SELECT id, 'public_usefulness_required', jsonb_build_object('automatic', true, 'threshold', 50.00)
  FROM paused;
