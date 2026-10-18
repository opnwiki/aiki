-- Search-created pages start without a public topic type. A background AI
-- classification chooses article, question, or discussion after the page is
-- already available at its canonical numeric address.
ALTER TABLE topics
  DROP CONSTRAINT IF EXISTS topics_kind_check;

ALTER TABLE topics
  ADD CONSTRAINT topics_kind_check
    CHECK (kind IN ('page', 'article', 'question', 'discussion'));

ALTER TABLE topic_ai_requests
  DROP CONSTRAINT IF EXISTS topic_ai_requests_request_type_check;

ALTER TABLE topic_ai_requests
  ADD CONSTRAINT topic_ai_requests_request_type_check
    CHECK (request_type IN ('classify_page', 'supplement', 'research', 'overview', 'discussion_reply', 'question_answer'));

COMMENT ON COLUMN topics.kind IS 'page while a search-created page is waiting for classification; otherwise article, question, or discussion.';
