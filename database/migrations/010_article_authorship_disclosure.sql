-- Public, self-reported provenance is attached to the immutable revision it describes.
-- NULL is retained for legacy revisions and non-article topics that predate disclosure.
-- A new article revision must explicitly declare authorship and any model used.

ALTER TABLE revisions
  ADD COLUMN IF NOT EXISTS authorship_mode TEXT,
  ADD COLUMN IF NOT EXISTS model_name TEXT,
  ADD COLUMN IF NOT EXISTS human_contribution TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revisions_authorship_mode_check') THEN
    ALTER TABLE revisions ADD CONSTRAINT revisions_authorship_mode_check
      CHECK (authorship_mode IS NULL OR authorship_mode IN (
        'human_only', 'human_ai_collaboration', 'ai_generated_human_reviewed', 'ai_generated_unreviewed', 'legacy_undisclosed'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revisions_authorship_model_consistency_check') THEN
    ALTER TABLE revisions ADD CONSTRAINT revisions_authorship_model_consistency_check
      CHECK (
        authorship_mode IS NULL
        OR (authorship_mode IN ('human_only', 'legacy_undisclosed') AND model_name IS NULL)
        OR (authorship_mode NOT IN ('human_only', 'legacy_undisclosed') AND model_name IS NOT NULL AND length(btrim(model_name)) BETWEEN 1 AND 160)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revisions_human_contribution_length_check') THEN
    ALTER TABLE revisions ADD CONSTRAINT revisions_human_contribution_length_check
      CHECK (human_contribution IS NULL OR length(human_contribution) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revisions_authorship_contribution_consistency_check') THEN
    ALTER TABLE revisions ADD CONSTRAINT revisions_authorship_contribution_consistency_check
      CHECK (
        authorship_mode IS NULL
        OR (authorship_mode IN ('human_only', 'human_ai_collaboration') AND human_contribution IS NOT NULL AND length(btrim(human_contribution)) BETWEEN 1 AND 500)
        OR (authorship_mode IN ('ai_generated_human_reviewed', 'ai_generated_unreviewed', 'legacy_undisclosed') AND human_contribution IS NULL)
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_article_revision_authorship()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM topics WHERE id = NEW.topic_id AND kind = 'article')
     AND NEW.authorship_mode IS NULL THEN
    RAISE EXCEPTION 'article revision authorship disclosure is required'
      USING ERRCODE = '23514', CONSTRAINT = 'article_revision_authorship_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS article_revision_authorship_required ON revisions;
CREATE TRIGGER article_revision_authorship_required
  BEFORE INSERT ON revisions
  FOR EACH ROW EXECUTE FUNCTION enforce_article_revision_authorship();
