CREATE INDEX IF NOT EXISTS replies_parent_reply_idx ON replies (parent_reply_id);
CREATE INDEX IF NOT EXISTS votes_target_idx ON votes (target_type, target_id);
