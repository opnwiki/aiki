-- Align accepted article-writing submissions with the node's supported authorship disclosures.
-- The immutable submission trigger remains in place; only the acceptance constraint changes.
DO $$
DECLARE
  old_constraint TEXT;
BEGIN
  SELECT conname INTO old_constraint
    FROM pg_constraint
   WHERE conrelid = 'article_writing_submissions'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%ai_generated_unreviewed%'
   LIMIT 1;

  IF old_constraint IS NULL THEN
    RAISE EXCEPTION 'Could not find the original article-writing authorship constraint';
  END IF;

  EXECUTE format('ALTER TABLE article_writing_submissions DROP CONSTRAINT %I', old_constraint);
END $$;

ALTER TABLE article_writing_submissions
  ADD CONSTRAINT article_writing_submissions_authorship_check
  CHECK (
    (kind = 'article'
      AND jsonb_array_length(sources) BETWEEN 1 AND 20
      AND authorship_mode IN (
        'human_only',
        'human_ai_collaboration',
        'ai_generated_human_reviewed',
        'ai_generated_unreviewed'
      )
      AND (
        (authorship_mode = 'human_only'
          AND model_name IS NULL
          AND human_contribution IS NOT NULL
          AND length(btrim(human_contribution)) BETWEEN 1 AND 500)
        OR (authorship_mode = 'human_ai_collaboration'
          AND model_name IS NOT NULL
          AND length(btrim(model_name)) BETWEEN 1 AND 160
          AND human_contribution IS NOT NULL
          AND length(btrim(human_contribution)) BETWEEN 1 AND 500)
        OR (authorship_mode IN ('ai_generated_human_reviewed', 'ai_generated_unreviewed')
          AND model_name IS NOT NULL
          AND length(btrim(model_name)) BETWEEN 1 AND 160
          AND human_contribution IS NULL)
      ))
    OR (kind <> 'article'
      AND jsonb_array_length(sources) <= 1
      AND authorship_mode IS NULL
      AND model_name IS NULL
      AND human_contribution IS NULL)
  );

COMMENT ON CONSTRAINT article_writing_submissions_authorship_check ON article_writing_submissions
  IS 'Matches the supported AIKI authorship disclosure modes for human and agent writing submissions.';
