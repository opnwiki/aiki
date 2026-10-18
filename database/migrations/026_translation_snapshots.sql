-- A translation revision points at the source revision it was made from.
-- Topic deletion removes both, so the provenance link cascades with the page.

ALTER TABLE revisions DROP CONSTRAINT IF EXISTS revisions_source_revision_restrict_fk;
ALTER TABLE revisions
  ADD CONSTRAINT revisions_source_revision_cascade_fk
  FOREIGN KEY (source_revision_id) REFERENCES revisions(id)
  ON DELETE CASCADE
  NOT VALID;
ALTER TABLE revisions VALIDATE CONSTRAINT revisions_source_revision_cascade_fk;

CREATE TABLE IF NOT EXISTS translation_snapshots (
  revision_id UUID PRIMARY KEY REFERENCES revisions(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  locale TEXT NOT NULL REFERENCES locales(lang),
  source_revision_id UUID NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  machine_title TEXT NOT NULL,
  machine_body TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS translation_snapshots_topic_locale_idx
  ON translation_snapshots (topic_id, locale, created_at DESC);

CREATE TABLE IF NOT EXISTS edit_proposal_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES edit_proposals(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0 AND position < 20),
  url TEXT NOT NULL,
  title TEXT,
  publisher TEXT,
  locator TEXT,
  note TEXT,
  UNIQUE (proposal_id, position)
);
