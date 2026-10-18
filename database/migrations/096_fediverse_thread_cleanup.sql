-- Pages copied from the Fediverse got a placeholder instead of an overview;
-- clearing it lets the normal overview task write a real one.
UPDATE topics
   SET summary = NULL
 WHERE summary LIKE 'Imported public Fediverse thread%'
    OR summary LIKE 'Inbound Fediverse question from %'
    OR summary LIKE 'Backfilled public Fediverse discussion%';

-- Re-reading a thread rewrote updated_at, so every Fediverse reply looked
-- edited. They cannot be edited here, so their edit time is their creation.
UPDATE replies
   SET updated_at = created_at
 WHERE federation_author_id IS NOT NULL
   AND author_id IS NULL
   AND updated_at IS DISTINCT FROM created_at;
