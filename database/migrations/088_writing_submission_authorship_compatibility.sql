-- Migration 046 introduced overview submissions but restored an older
-- AI-only content constraint. Match the authorship modes supported by the
-- writing API and migration 013 while retaining the overview branch.
ALTER TABLE article_writing_submissions
  DROP CONSTRAINT article_writing_submissions_content_check,
  ADD CONSTRAINT article_writing_submissions_content_check CHECK (
    (kind = 'article'
      AND jsonb_array_length(sources) BETWEEN 1 AND 20
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
    OR (kind = 'overview'
      AND overview IS NOT NULL AND jsonb_array_length(sources) <= 20
      AND authorship_mode IS NULL AND model_name IS NULL AND human_contribution IS NULL)
    OR (kind IN ('question', 'discussion')
      AND jsonb_array_length(sources) <= 1
      AND authorship_mode IS NULL AND model_name IS NULL AND human_contribution IS NULL)
  );
