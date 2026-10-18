-- A machine translation is not the authoring provenance of the page.
-- Restore the source revision's disclosure on translations created before
-- translation metadata was separated from the MyMemory provider name.
-- This is a one-time data repair for immutable history. Keep the trigger
-- disabled only for this statement and restore it before the migration ends.
ALTER TABLE revisions DISABLE TRIGGER revisions_immutable;

UPDATE revisions translated
   SET authorship_mode = source.authorship_mode,
       model_name = source.model_name,
       human_contribution = source.human_contribution
  FROM translation_snapshots snapshot
  JOIN revisions source ON source.id = snapshot.source_revision_id
 WHERE snapshot.revision_id = translated.id
   AND translated.source_revision_id IS NOT NULL;

ALTER TABLE revisions ENABLE TRIGGER revisions_immutable;
