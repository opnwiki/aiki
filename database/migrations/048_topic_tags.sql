-- Shared per-node tags for published pages and future tag discovery.
CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, slug),
  CHECK (char_length(slug) BETWEEN 1 AND 48),
  CHECK (char_length(label) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS tags_node_slug_idx ON tags(node_id, slug);

CREATE TABLE IF NOT EXISTS topic_tags (
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 7),
  PRIMARY KEY (topic_id, tag_id),
  UNIQUE (topic_id, position)
);

CREATE INDEX IF NOT EXISTS topic_tags_tag_topic_idx ON topic_tags(tag_id, topic_id);
