-- Short-lived, admin-only traffic analytics.
-- Raw IPs are retained for 30 days so node administrators can investigate
-- traffic. Raw User-Agent strings are intentionally not stored.
CREATE TABLE IF NOT EXISTS site_visit_analytics (
  visitor_date DATE NOT NULL DEFAULT CURRENT_DATE,
  visitor_hash TEXT NOT NULL,
  ip_address INET NOT NULL,
  visitor_kind TEXT NOT NULL CHECK (visitor_kind IN ('human', 'agent', 'bot')),
  client_label TEXT NOT NULL,
  country_code TEXT,
  device_type TEXT NOT NULL,
  os_family TEXT NOT NULL,
  browser_family TEXT NOT NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1 CHECK (hits > 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (visitor_date, visitor_hash, path)
);

CREATE INDEX IF NOT EXISTS site_visit_analytics_last_seen_idx
  ON site_visit_analytics (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS site_visit_analytics_topic_idx
  ON site_visit_analytics (topic_id, last_seen_at DESC)
  WHERE topic_id IS NOT NULL;
