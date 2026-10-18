CREATE TABLE IF NOT EXISTS reply_translations (
  reply_id UUID NOT NULL REFERENCES replies(id) ON DELETE CASCADE,
  locale TEXT NOT NULL REFERENCES locales(lang),
  body_markdown TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reply_id, locale)
);

CREATE INDEX IF NOT EXISTS reply_translations_locale_idx
  ON reply_translations (locale, created_at DESC);
