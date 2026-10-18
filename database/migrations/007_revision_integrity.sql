-- A revision's parent must be from the same topic and locale. Use CASCADE only
-- so deleting an entire topic can remove its complete revision tree atomically;
-- direct revision deletion is blocked below.
ALTER TABLE revisions
  DROP CONSTRAINT IF EXISTS revisions_parent_revision_id_fkey;

ALTER TABLE revisions
  ADD CONSTRAINT revisions_parent_context_fk
  FOREIGN KEY (topic_id, locale, parent_revision_id)
  REFERENCES revisions (topic_id, locale, id)
  ON DELETE CASCADE
  NOT VALID;
ALTER TABLE revisions VALIDATE CONSTRAINT revisions_parent_context_fk;

-- Immutable history cannot have FK actions silently rewrite attribution or
-- translation provenance. Such referenced rows must be handled explicitly.
ALTER TABLE revisions
  DROP CONSTRAINT IF EXISTS revisions_author_id_fkey;
ALTER TABLE revisions
  ADD CONSTRAINT revisions_author_restrict_fk
  FOREIGN KEY (author_id) REFERENCES actors(id)
  ON DELETE RESTRICT
  NOT VALID;
ALTER TABLE revisions VALIDATE CONSTRAINT revisions_author_restrict_fk;

ALTER TABLE revisions
  DROP CONSTRAINT IF EXISTS revisions_source_revision_id_fkey;
ALTER TABLE revisions
  ADD CONSTRAINT revisions_source_revision_restrict_fk
  FOREIGN KEY (source_revision_id) REFERENCES revisions(id)
  ON DELETE RESTRICT
  NOT VALID;
ALTER TABLE revisions VALIDATE CONSTRAINT revisions_source_revision_restrict_fk;

CREATE OR REPLACE FUNCTION prevent_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- PostgreSQL FK cascades are nested trigger invocations. Permit those only
  -- when deleting a topic and cascading its whole revision history.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'published revisions are immutable; create a new revision instead'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER revisions_immutable
  BEFORE UPDATE OR DELETE ON revisions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_revision_mutation();

COMMENT ON FUNCTION prevent_revision_mutation() IS
  'Prevents direct edits/deletes to published revision history; whole-topic cascade deletion remains allowed.';
