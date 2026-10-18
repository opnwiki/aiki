-- Rolling site-wide activity identities for the public 24-hour presence counter.
-- Only HMAC digests are stored; raw IP addresses and User-Agent strings stay out of the database.
CREATE TABLE IF NOT EXISTS site_activity (
  visitor_hash TEXT PRIMARY KEY,
  visitor_kind TEXT NOT NULL CHECK (visitor_kind IN ('human', 'agent', 'bot')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_activity_last_seen_idx
  ON site_activity (last_seen_at DESC);
