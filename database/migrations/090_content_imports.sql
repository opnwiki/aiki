-- Generic connector imports. The private Telegram service is not bundled here.
-- Additive tables; CHECK replacements briefly lock revisions. Revoke connector
-- credentials for rollback, preserving published pages and immutable history.
ALTER TABLE revisions DROP CONSTRAINT IF EXISTS revisions_authorship_mode_check;
ALTER TABLE revisions ADD CONSTRAINT revisions_authorship_mode_check CHECK (
  authorship_mode IS NULL OR authorship_mode IN ('human_only', 'human_ai_collaboration',
    'ai_generated_human_reviewed', 'ai_generated_unreviewed', 'legacy_undisclosed', 'external_import')
);
ALTER TABLE revisions DROP CONSTRAINT IF EXISTS revisions_authorship_model_consistency_check;
ALTER TABLE revisions ADD CONSTRAINT revisions_authorship_model_consistency_check CHECK (
  authorship_mode IS NULL
  OR (authorship_mode IN ('human_only', 'legacy_undisclosed', 'external_import') AND model_name IS NULL)
  OR (authorship_mode NOT IN ('human_only', 'legacy_undisclosed', 'external_import')
      AND model_name IS NOT NULL AND length(btrim(model_name)) BETWEEN 1 AND 160)
);
ALTER TABLE revisions DROP CONSTRAINT IF EXISTS revisions_authorship_contribution_consistency_check;
ALTER TABLE revisions ADD CONSTRAINT revisions_authorship_contribution_consistency_check CHECK (
  authorship_mode IS NULL
  OR (authorship_mode IN ('human_only', 'human_ai_collaboration') AND human_contribution IS NOT NULL AND length(btrim(human_contribution)) BETWEEN 1 AND 500)
  OR (authorship_mode IN ('ai_generated_human_reviewed', 'ai_generated_unreviewed', 'legacy_undisclosed', 'external_import') AND human_contribution IS NULL)
);

CREATE TABLE IF NOT EXISTS content_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
  connector TEXT NOT NULL,
  external_source_key TEXT NOT NULL CHECK (char_length(external_source_key) BETWEEN 1 AND 512),
  topic_id UUID NOT NULL UNIQUE REFERENCES topics(id) ON DELETE CASCADE,
  requested_by_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  author_identity_id UUID REFERENCES external_identities(id) ON DELETE RESTRICT,
  last_revision_id UUID NOT NULL REFERENCES revisions(id) ON DELETE RESTRICT,
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, connector, external_source_key),
  UNIQUE (id, topic_id)
);

CREATE TABLE IF NOT EXISTS content_import_revisions (
  revision_id UUID PRIMARY KEY,
  import_id UUID NOT NULL,
  topic_id UUID NOT NULL,
  locale TEXT NOT NULL,
  source_snapshot JSONB NOT NULL,
  author_snapshot JSONB,
  formatting JSONB NOT NULL,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (import_id, topic_id) REFERENCES content_imports(id, topic_id) ON DELETE CASCADE,
  FOREIGN KEY (topic_id, locale, revision_id) REFERENCES revisions(topic_id, locale, id) ON DELETE CASCADE
);
DROP TRIGGER IF EXISTS content_import_revisions_immutable ON content_import_revisions;
CREATE TRIGGER content_import_revisions_immutable BEFORE UPDATE OR DELETE ON content_import_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_revision_mutation();

CREATE TABLE IF NOT EXISTS content_import_receipts (
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
  connector TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  external_source_key TEXT NOT NULL,
  import_id UUID NOT NULL REFERENCES content_imports(id) ON DELETE CASCADE,
  proposal_id UUID REFERENCES edit_proposals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, connector, idempotency_key)
);

CREATE TABLE IF NOT EXISTS content_import_proposals (
  proposal_id UUID PRIMARY KEY REFERENCES edit_proposals(id) ON DELETE CASCADE,
  import_id UUID NOT NULL REFERENCES content_imports(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  source_snapshot JSONB NOT NULL,
  formatting JSONB NOT NULL,
  UNIQUE (import_id, source_hash)
);

CREATE OR REPLACE FUNCTION require_external_import_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.authorship_mode = 'external_import'
     AND NOT EXISTS (SELECT 1 FROM content_import_revisions WHERE revision_id = NEW.id)
     AND NOT EXISTS (SELECT 1 FROM revisions previous WHERE previous.topic_id = NEW.topic_id
       AND previous.authorship_mode = 'external_import'
       AND (previous.id = NEW.parent_revision_id OR previous.id = NEW.source_revision_id)) THEN
    RAISE EXCEPTION 'an external import requires immutable source provenance'
      USING ERRCODE = '23514', CONSTRAINT = 'external_import_provenance_required';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS external_import_provenance_required ON revisions;
CREATE CONSTRAINT TRIGGER external_import_provenance_required AFTER INSERT ON revisions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_external_import_provenance();

CREATE INDEX IF NOT EXISTS content_import_revisions_topic_idx ON content_import_revisions(topic_id, imported_at DESC);
COMMENT ON TABLE content_imports IS 'Internal connector ledger. Sender identity and immutable source keys are never serialized in public page data.';
COMMENT ON TABLE content_import_revisions IS 'Immutable source and formatting snapshots. external_import does not assert whether the original author used AI.';
