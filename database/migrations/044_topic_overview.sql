ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS summary TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'topics_summary_length_check'
       AND conrelid = 'topics'::regclass
  ) THEN
    ALTER TABLE topics ADD CONSTRAINT topics_summary_length_check
      CHECK (summary IS NULL OR length(summary) <= 2000);
  END IF;
END $$;

ALTER TABLE article_writing_submissions
  ADD COLUMN IF NOT EXISTS overview TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'article_writing_submissions_overview_length_check'
       AND conrelid = 'article_writing_submissions'::regclass
  ) THEN
    ALTER TABLE article_writing_submissions ADD CONSTRAINT article_writing_submissions_overview_length_check
      CHECK (overview IS NULL OR length(overview) <= 2000);
  END IF;
END $$;
