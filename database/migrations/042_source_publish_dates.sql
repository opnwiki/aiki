-- Source publication dates: extracted from source HTML when an article is filled,
-- falling back to the date recorded when the source was added.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS published_at DATE;
