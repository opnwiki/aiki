ALTER TABLE revision_diffs
  DROP CONSTRAINT IF EXISTS revision_diffs_origin_check;

ALTER TABLE revision_diffs
  ADD CONSTRAINT revision_diffs_origin_check
  CHECK (origin IN ('publication', 'accepted_edit', 'author_edit', 'translation', 'import'));
