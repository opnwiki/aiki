-- The model check belongs to the node. An admin sets the provider, model, and key once.
-- Every page is included until an admin turns that page's switch off.
ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS assistant_moderation JSONB;

ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS assistant_check BOOLEAN NOT NULL DEFAULT true;
