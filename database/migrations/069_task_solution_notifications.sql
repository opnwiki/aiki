-- Notify the page author and node staff when a unified task receives a
-- solution that waits for their review, so it does not sit unnoticed in /tasks.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS task_solution_id UUID REFERENCES content_task_solutions(id) ON DELETE CASCADE;

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_kind_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'edit_proposal',
    'proposal_accepted',
    'proposal_rejected',
    'page_comment',
    'comment_reply',
    'page_transfer',
    'task_solution'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS notifications_task_solution_once_idx
  ON notifications (recipient_id, kind, task_solution_id)
  WHERE task_solution_id IS NOT NULL;
