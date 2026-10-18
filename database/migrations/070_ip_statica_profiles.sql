-- Statica's profile of a client IP (country and security flags), kept
-- permanently and refreshed at least once a day when the IP is seen again.
-- Rate limits scale by these flags; analytics reads the country.
CREATE TABLE IF NOT EXISTS ip_statica_profiles (
  ip INET PRIMARY KEY,
  country TEXT CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  security JSONB CHECK (security IS NULL OR jsonb_typeof(security) = 'object'),
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
