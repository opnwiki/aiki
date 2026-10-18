-- Community tasks for proposing a short overview for an already-published article.
-- The task points at one current revision. A submitted overview becomes an
-- edit proposal, so existing proposal votes and author stance stay authoritative.

ALTER TABLE article_writing_tasks
  ALTER COLUMN order_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'writing',
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS target_revision_id UUID REFERENCES revisions(id) ON DELETE RESTRICT;

ALTER TABLE article_writing_tasks
  DROP CONSTRAINT IF EXISTS article_writing_tasks_task_type_check,
  DROP CONSTRAINT IF EXISTS article_writing_tasks_target_check;

ALTER TABLE article_writing_tasks
  ADD CONSTRAINT article_writing_tasks_task_type_check
    CHECK (task_type IN ('writing', 'overview')),
  ADD CONSTRAINT article_writing_tasks_target_check
    CHECK (
      (task_type = 'writing' AND order_id IS NOT NULL AND topic_id IS NULL AND target_revision_id IS NULL)
      OR
      (task_type = 'overview' AND order_id IS NULL AND topic_id IS NOT NULL AND target_revision_id IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS article_writing_tasks_overview_target_idx
  ON article_writing_tasks (target_revision_id)
  WHERE task_type = 'overview';

-- A proposal can be a full article edit or an overview-only edit. For an
-- overview proposal the body is kept equal to the base revision so the
-- existing immutable revision/proposal machinery can still be reused.
ALTER TABLE edit_proposals
  ADD COLUMN IF NOT EXISTS proposal_type TEXT NOT NULL DEFAULT 'body',
  ADD COLUMN IF NOT EXISTS proposed_summary TEXT,
  ADD COLUMN IF NOT EXISTS source_task_id UUID REFERENCES article_writing_tasks(id) ON DELETE SET NULL;

ALTER TABLE edit_proposals
  DROP CONSTRAINT IF EXISTS edit_proposals_proposal_type_check,
  DROP CONSTRAINT IF EXISTS edit_proposals_proposed_summary_length_check,
  DROP CONSTRAINT IF EXISTS edit_proposals_proposal_content_check;

ALTER TABLE edit_proposals
  ADD CONSTRAINT edit_proposals_proposal_type_check
    CHECK (proposal_type IN ('body', 'overview')),
  ADD CONSTRAINT edit_proposals_proposed_summary_length_check
    CHECK (proposed_summary IS NULL OR length(btrim(proposed_summary)) BETWEEN 20 AND 2000),
  ADD CONSTRAINT edit_proposals_proposal_content_check
    CHECK (
      (proposal_type = 'body' AND proposed_summary IS NULL)
      OR
      (proposal_type = 'overview' AND proposed_summary IS NOT NULL AND proposed_title IS NULL)
    );

-- Existing article_writing_submissions are full writing submissions. Overview
-- tasks store the target article body in the immutable record for traceability,
-- while only the overview is proposed.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'article_writing_submissions'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE article_writing_submissions DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE article_writing_submissions
  ADD CONSTRAINT article_writing_submissions_kind_check
    CHECK (kind IN ('article', 'question', 'discussion', 'overview')),
  ADD CONSTRAINT article_writing_submissions_content_check
    CHECK (
      (kind = 'article' AND jsonb_array_length(sources) BETWEEN 1 AND 20
       AND authorship_mode = 'ai_generated_unreviewed'
       AND model_name IS NOT NULL AND length(btrim(model_name)) BETWEEN 1 AND 160
       AND human_contribution IS NULL)
      OR
      (kind = 'overview' AND overview IS NOT NULL AND jsonb_array_length(sources) <= 20
       AND authorship_mode IS NULL AND model_name IS NULL AND human_contribution IS NULL)
      OR
      (kind IN ('question', 'discussion') AND jsonb_array_length(sources) <= 1
       AND authorship_mode IS NULL AND model_name IS NULL AND human_contribution IS NULL)
    );

-- One task per current article revision without an overview. Re-running this
-- statement is safe because of the partial unique index above.
INSERT INTO article_writing_tasks (task_type, topic_id, target_revision_id, status)
SELECT 'overview', topic.id, current.revision_id, 'open'
  FROM topics topic
  JOIN topic_current_revisions current ON current.topic_id = topic.id
  JOIN revisions revision ON revision.id = current.revision_id
 WHERE topic.kind = 'article'
   AND topic.status IN ('published', 'unlisted')
   AND coalesce(nullif(btrim(topic.summary), ''), nullif(btrim(revision.summary), '')) IS NULL
ON CONFLICT (target_revision_id) WHERE task_type = 'overview' DO NOTHING;
