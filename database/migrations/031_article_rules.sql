-- Per-node additions and exceptions to the shared article publication rules.
ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS article_rule_overrides JSONB NOT NULL DEFAULT '[]'::jsonb;
