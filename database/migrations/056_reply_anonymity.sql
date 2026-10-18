ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS author_hidden BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN replies.author_hidden IS
  'Keep the author account for internal ownership and notifications, but hide identity on public replies.';
