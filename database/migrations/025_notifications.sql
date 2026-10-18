-- Per-account notices for edit proposals, comments, and page offers.
-- A row stays after it is read so the section can show what already happened.

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'edit_proposal',
    'proposal_accepted',
    'proposal_rejected',
    'page_comment',
    'comment_reply',
    'page_transfer'
  )),
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  proposal_id UUID REFERENCES edit_proposals(id) ON DELETE CASCADE,
  reply_id UUID REFERENCES replies(id) ON DELETE CASCADE,
  transfer_id UUID REFERENCES page_transfers(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_inbox_idx
  ON notifications (recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (recipient_id)
  WHERE read_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_proposal_once_idx
  ON notifications (recipient_id, kind, proposal_id)
  WHERE proposal_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_reply_once_idx
  ON notifications (recipient_id, kind, reply_id)
  WHERE reply_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_transfer_once_idx
  ON notifications (recipient_id, kind, transfer_id)
  WHERE transfer_id IS NOT NULL;
