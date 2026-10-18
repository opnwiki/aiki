-- A page can be public, reachable only by its address, or visible only to its author.
ALTER TABLE topics DROP CONSTRAINT IF EXISTS topics_status_check;

ALTER TABLE topics
  ADD CONSTRAINT topics_status_check
  CHECK (status IN ('published', 'unlisted', 'hidden', 'deleted'));
