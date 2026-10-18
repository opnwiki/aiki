-- Review metadata is prepared for the later human review API; this migration
-- does not grant review authority or change any proposal status.
ALTER TABLE edit_proposals
  ADD COLUMN IF NOT EXISTS reviewed_by_actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_comment TEXT,
  ADD COLUMN IF NOT EXISTS result_revision_id UUID REFERENCES revisions(id) ON DELETE SET NULL;

ALTER TABLE edit_proposals
  ADD CONSTRAINT edit_proposals_base_revision_context_fk
  FOREIGN KEY (topic_id, locale, base_revision_id)
  REFERENCES revisions (topic_id, locale, id)
  ON DELETE RESTRICT
  NOT VALID;

-- NOT VALID avoids requiring a rewrite or implicit adoption of legacy rows;
-- PostgreSQL enforces this relationship for every new or updated row.

CREATE INDEX IF NOT EXISTS edit_proposals_reviewer_created_idx
  ON edit_proposals (reviewed_by_actor_id, reviewed_at DESC)
  WHERE reviewed_by_actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS edit_proposals_result_revision_idx
  ON edit_proposals (result_revision_id)
  WHERE result_revision_id IS NOT NULL;
