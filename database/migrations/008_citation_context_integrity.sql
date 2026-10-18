-- Citations must point to exactly one target and that target must belong to
-- the same topic. Populate topic_id from existing targets before making it
-- mandatory; the migration fails rather than guessing for inconsistent rows.
ALTER TABLE revisions
  ADD CONSTRAINT revisions_topic_id_id_key UNIQUE (topic_id, id);

ALTER TABLE replies
  ADD CONSTRAINT replies_topic_id_id_key UNIQUE (topic_id, id);

ALTER TABLE citations
  ADD COLUMN topic_id UUID;

UPDATE citations citation
   SET topic_id = coalesce(
     (SELECT revision.topic_id FROM revisions revision WHERE revision.id = citation.revision_id),
     (SELECT reply.topic_id FROM replies reply WHERE reply.id = citation.reply_id)
   )
 WHERE citation.topic_id IS NULL;

ALTER TABLE citations
  ALTER COLUMN topic_id SET NOT NULL;

ALTER TABLE citations
  ADD CONSTRAINT citations_exactly_one_target_ck
  CHECK (num_nonnulls(revision_id, reply_id) = 1)
  NOT VALID;
ALTER TABLE citations VALIDATE CONSTRAINT citations_exactly_one_target_ck;

-- 001 created an equivalent unnamed-or-autonamed legacy check. Remove it so
-- new invalid rows fail through the explicit integrity constraint above.
ALTER TABLE citations
  DROP CONSTRAINT IF EXISTS citations_check;

ALTER TABLE citations
  DROP CONSTRAINT IF EXISTS citations_revision_id_fkey;
ALTER TABLE citations
  DROP CONSTRAINT IF EXISTS citations_reply_id_fkey;

ALTER TABLE citations
  ADD CONSTRAINT citations_revision_context_fk
  FOREIGN KEY (topic_id, revision_id)
  REFERENCES revisions (topic_id, id)
  ON DELETE CASCADE
  NOT VALID;
ALTER TABLE citations VALIDATE CONSTRAINT citations_revision_context_fk;

ALTER TABLE citations
  ADD CONSTRAINT citations_reply_context_fk
  FOREIGN KEY (topic_id, reply_id)
  REFERENCES replies (topic_id, id)
  ON DELETE CASCADE
  NOT VALID;
ALTER TABLE citations VALIDATE CONSTRAINT citations_reply_context_fk;

CREATE INDEX IF NOT EXISTS citations_topic_revision_idx
  ON citations (topic_id, revision_id)
  WHERE revision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS citations_topic_reply_idx
  ON citations (topic_id, reply_id)
  WHERE reply_id IS NOT NULL;

COMMENT ON COLUMN citations.topic_id IS
  'Topic owning the cited revision or reply; composite foreign keys prevent cross-topic citations.';
