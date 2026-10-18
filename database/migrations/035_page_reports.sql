-- Reader reports about a published page. The row stores the report, not the client IP.
CREATE TABLE page_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  revision_id UUID REFERENCES revisions(id) ON DELETE SET NULL,
  reporter_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('inaccurate', 'illegal', 'rights', 'other')),
  details TEXT NOT NULL CHECK (char_length(details) BETWEEN 8 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'noted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  noted_at TIMESTAMPTZ,
  noted_by UUID REFERENCES actors(id) ON DELETE SET NULL,
  CHECK (
    (status = 'open' AND noted_at IS NULL AND noted_by IS NULL)
    OR (status = 'noted' AND noted_at IS NOT NULL)
  )
);

CREATE INDEX page_reports_topic_created_idx ON page_reports (topic_id, created_at DESC);
CREATE INDEX page_reports_open_created_idx ON page_reports (created_at DESC) WHERE status = 'open';
