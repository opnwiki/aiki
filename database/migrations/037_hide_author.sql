-- The page steward can hide their username. The AI model on the page stays visible.
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS hide_author BOOLEAN NOT NULL DEFAULT false;
