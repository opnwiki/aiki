CREATE TABLE IF NOT EXISTS topic_readers (
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  reader_type TEXT NOT NULL CHECK (reader_type IN ('web', 'agent')),
  reader_hash TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_id, reader_type, reader_hash)
);

CREATE INDEX IF NOT EXISTS topic_readers_topic_type_idx
  ON topic_readers (topic_id, reader_type, first_seen_at DESC);

UPDATE page_read_counts counts
   SET unique_web_readers = readers.unique_count
  FROM (
    SELECT topic_id, count(*)::bigint AS unique_count
      FROM topic_readers
     WHERE reader_type = 'web'
     GROUP BY topic_id
  ) readers
 WHERE readers.topic_id = counts.topic_id;
