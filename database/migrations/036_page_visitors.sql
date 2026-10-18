-- Public page-visit totals by classified client. The raw User-Agent and client IP are not stored.
CREATE TABLE page_view_clients (
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  client_label TEXT NOT NULL CHECK (char_length(client_label) BETWEEN 1 AND 80),
  client_kind TEXT NOT NULL CHECK (client_kind IN ('human', 'bot')),
  hits BIGINT NOT NULL DEFAULT 0 CHECK (hits >= 0),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_id, client_label)
);
