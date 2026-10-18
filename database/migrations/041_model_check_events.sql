-- Page checks now run on publication, republication, and an accepted text change.
ALTER TABLE moderation_checks DROP CONSTRAINT IF EXISTS moderation_checks_trigger_check;
ALTER TABLE moderation_checks
  ADD CONSTRAINT moderation_checks_trigger_check
  CHECK (trigger IN ('publish', 'views', 'republish', 'change'));
