-- Sequential page numbers are local to this node's database. A deleted page
-- leaves a gap; the number is never issued again. Other nodes number their own pages.
CREATE SEQUENCE topic_page_number_seq AS BIGINT;

ALTER TABLE topics ADD COLUMN page_number BIGINT;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
    FROM topics
)
UPDATE topics AS topic
   SET page_number = numbered.n
  FROM numbered
 WHERE topic.id = numbered.id;

SELECT setval(
  'topic_page_number_seq',
  GREATEST((SELECT COALESCE(MAX(page_number), 1) FROM topics), 1),
  (SELECT EXISTS (SELECT 1 FROM topics))
);

ALTER TABLE topics
  ALTER COLUMN page_number SET NOT NULL,
  ADD CONSTRAINT topics_page_number_positive CHECK (page_number >= 1);
CREATE UNIQUE INDEX topics_page_number_unique ON topics (page_number);
ALTER SEQUENCE topic_page_number_seq OWNED BY topics.page_number;

CREATE OR REPLACE FUNCTION assign_topic_page_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.page_number IS NOT NULL THEN
    RAISE EXCEPTION 'page numbers are assigned by the database'
      USING ERRCODE = '23514', CONSTRAINT = 'topics_page_number_managed';
  END IF;
  NEW.page_number := nextval('topic_page_number_seq');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topics_assign_page_number ON topics;
CREATE TRIGGER topics_assign_page_number
  BEFORE INSERT ON topics
  FOR EACH ROW EXECUTE FUNCTION assign_topic_page_number();

CREATE OR REPLACE FUNCTION protect_topic_page_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.page_number IS DISTINCT FROM OLD.page_number THEN
    RAISE EXCEPTION 'page numbers are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'topics_page_number_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topics_page_number_immutable ON topics;
CREATE TRIGGER topics_page_number_immutable
  BEFORE UPDATE OF page_number ON topics
  FOR EACH ROW EXECUTE FUNCTION protect_topic_page_number();

COMMENT ON COLUMN topics.page_number IS 'Monotonic page number local to this node. Assigned at insert and never reused.';
