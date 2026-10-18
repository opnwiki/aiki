-- Page addresses are compared without case so a typed code finds its page.
-- Existing slugs stay as stored. New pages receive a short code unless a free address is chosen.
CREATE UNIQUE INDEX IF NOT EXISTS topics_slug_lower_unique ON topics (lower(slug));
