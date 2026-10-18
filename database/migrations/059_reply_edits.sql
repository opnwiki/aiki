-- Replies are editable by their own human author. Keep the original creation
-- timestamp and record the last content/privacy change separately.
ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE replies
   SET updated_at = created_at
 WHERE updated_at IS NULL;

ALTER TABLE replies
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

COMMENT ON COLUMN replies.updated_at IS
  'Last time the reply body or public author visibility changed.';
