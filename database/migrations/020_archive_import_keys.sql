-- A repeated account import recognizes pages and comments this person already has.
-- import_key is the archive address (page slug or comment id) from the file that
-- first brought the row in. The public page address can differ when that slug was taken.

ALTER TABLE topics ADD COLUMN IF NOT EXISTS import_key TEXT;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS import_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'topics_import_key_len') THEN
    ALTER TABLE topics ADD CONSTRAINT topics_import_key_len
      CHECK (import_key IS NULL OR char_length(import_key) BETWEEN 1 AND 96);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'replies_import_key_len') THEN
    ALTER TABLE replies ADD CONSTRAINT replies_import_key_len
      CHECK (import_key IS NULL OR char_length(import_key) BETWEEN 1 AND 80);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS topics_author_import_key_idx
  ON topics (author_id, import_key)
  WHERE import_key IS NOT NULL AND author_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS replies_author_import_key_idx
  ON replies (author_id, import_key)
  WHERE import_key IS NOT NULL AND author_id IS NOT NULL;
