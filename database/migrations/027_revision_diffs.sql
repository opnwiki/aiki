-- A complete line diff for every published revision. Applying the ops to the
-- parent text restores this revision; reverting them restores the previous text.
CREATE TABLE IF NOT EXISTS revision_diffs (
  revision_id UUID PRIMARY KEY REFERENCES revisions(id) ON DELETE CASCADE,
  parent_revision_id UUID,
  proposal_id UUID,
  origin TEXT NOT NULL CHECK (origin IN ('publication', 'accepted_edit', 'translation', 'import')),
  introduced_by_actor_id UUID REFERENCES actors(id) ON DELETE RESTRICT,
  confirmed_by_actor_id UUID REFERENCES actors(id) ON DELETE RESTRICT,
  introduced_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL,
  introduced_label TEXT,
  confirmed_label TEXT,
  title_ops JSONB NOT NULL CHECK (jsonb_typeof(title_ops) = 'array'),
  body_ops JSONB NOT NULL CHECK (jsonb_typeof(body_ops) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revision_diffs_parent_idx
  ON revision_diffs (parent_revision_id)
  WHERE parent_revision_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_revision_diff_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'stored revision diffs are immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS revision_diffs_immutable ON revision_diffs;
CREATE TRIGGER revision_diffs_immutable
  BEFORE UPDATE OR DELETE ON revision_diffs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_revision_diff_mutation();

COMMENT ON TABLE revision_diffs IS
  'Immutable line diff, author and confirmer for one published revision.';
