-- Reconcile the public web-reader total from the HMAC identities already stored.
-- These hashes are deliberately retained; raw client addresses are never stored.
UPDATE page_read_counts counts
   SET unique_web_readers = (
     SELECT count(*)::bigint
       FROM topic_readers readers
      WHERE readers.topic_id = counts.topic_id
        AND readers.reader_type = 'web'
   );