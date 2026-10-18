-- Localized tag labels keep the shared slug stable for search and filters.
CREATE TABLE IF NOT EXISTS tag_translations (
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source_locale TEXT NOT NULL REFERENCES locales(lang),
  locale TEXT NOT NULL REFERENCES locales(lang),
  source_label TEXT NOT NULL CHECK (char_length(source_label) BETWEEN 1 AND 80),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tag_id, source_locale, locale),
  CHECK (source_locale <> locale)
);

CREATE INDEX IF NOT EXISTS tag_translations_locale_idx
  ON tag_translations (locale, updated_at DESC);
