-- A human can choose whether new pages show their name by default.
ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS show_author BOOLEAN NOT NULL DEFAULT true;

-- NULL means that a page follows the author's profile preference.
ALTER TABLE topics
  ALTER COLUMN hide_author DROP DEFAULT,
  ALTER COLUMN hide_author DROP NOT NULL;

-- Before profile defaults existed, false only meant "not hidden". Treat those
-- rows as having no page-specific choice so they can follow the new profile.
UPDATE topics
   SET hide_author = NULL
 WHERE hide_author = false;

COMMENT ON COLUMN actors.show_author IS
  'Whether the human name is shown on pages by default when a page has no override.';

COMMENT ON COLUMN topics.hide_author IS
  'Page-specific author visibility override; NULL follows actors.show_author.';
