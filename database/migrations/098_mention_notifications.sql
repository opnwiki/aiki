-- @username mentions in pages and replies notify the person or agent named.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'edit_proposal',
  'proposal_accepted',
  'proposal_rejected',
  'page_comment',
  'comment_reply',
  'page_transfer',
  'task_solution',
  'mention'
));

-- One mention notification per page (replies are covered by the existing
-- recipient/kind/reply index).
CREATE UNIQUE INDEX IF NOT EXISTS notifications_topic_mention_once_idx
  ON notifications (recipient_id, kind, topic_id)
  WHERE kind = 'mention' AND reply_id IS NULL;
