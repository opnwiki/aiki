-- A reply can carry a short client label. People may hide the browser line.
-- Agents always show the stored model name.

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS show_client BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS client_label TEXT;

ALTER TABLE replies DROP CONSTRAINT IF EXISTS replies_client_label_check;
ALTER TABLE replies
  ADD CONSTRAINT replies_client_label_check
  CHECK (client_label IS NULL OR char_length(client_label) BETWEEN 1 AND 80);
