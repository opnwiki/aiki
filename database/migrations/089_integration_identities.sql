-- Generic integration credentials and verified external identities. Integrations
-- remain disabled until AIKI_INTEGRATIONS_ENABLED=true is explicitly configured.
-- Additive/idempotent; no ledger or existing migration checksum is rewritten.
-- The actor CHECK replacement briefly locks actors. Forward repair/revocation is
-- the rollback path: retain external actors and their attribution, revoke keys.
ALTER TABLE actors DROP CONSTRAINT IF EXISTS actors_kind_check;
ALTER TABLE actors ADD CONSTRAINT actors_kind_check CHECK (kind IN ('human', 'agent', 'system', 'external'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actors_external_permissions_check') THEN
    ALTER TABLE actors ADD CONSTRAINT actors_external_permissions_check CHECK (
      kind <> 'external' OR (password_hash IS NULL AND api_key_hash IS NULL AND role = 'member' AND federation_enabled = false)
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS integration_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
  connector TEXT NOT NULL CHECK (connector ~ '^[a-z][a-z0-9_-]{1,63}$'),
  provider TEXT NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{1,63}$'),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 3 AND scopes <@ ARRAY['imports:read', 'imports:write', 'account-links:write']::text[]),
  identity_providers TEXT[] NOT NULL CHECK (cardinality(identity_providers) BETWEEN 1 AND 8 AND provider = ANY(identity_providers)),
  allowed_media_origins TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES actors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS integration_credentials_node_idx ON integration_credentials (node_id, created_at DESC);

ALTER TABLE human_sessions ADD COLUMN IF NOT EXISTS integration_credential_id UUID REFERENCES integration_credentials(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS human_sessions_integration_credential_idx ON human_sessions (integration_credential_id) WHERE integration_credential_id IS NOT NULL AND revoked_at IS NULL;
COMMENT ON COLUMN human_sessions.integration_credential_id IS 'Issuer of a passwordless integration sign-in; credential soft revocation also revokes these sessions. Existing browser-owned sessions retain their issuer during account linking.';

CREATE TABLE IF NOT EXISTS external_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{1,63}$'),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'channel', 'publisher')),
  subject_key TEXT NOT NULL CHECK (char_length(subject_key) BETWEEN 1 AND 256),
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  initial_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  username TEXT,
  display_name TEXT,
  profile_url TEXT,
  avatar_url TEXT,
  verified_at TIMESTAMPTZ,
  account_linked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, provider, subject_type, subject_key)
);
CREATE INDEX IF NOT EXISTS external_identities_actor_idx ON external_identities (actor_id);

CREATE TABLE IF NOT EXISTS integration_account_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID NOT NULL REFERENCES integration_credentials(id) ON DELETE RESTRICT,
  identity_id UUID NOT NULL REFERENCES external_identities(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'link')),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
  consumed_at TIMESTAMPTZ,
  consumed_by UUID REFERENCES actors(id) ON DELETE SET NULL,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);
CREATE INDEX IF NOT EXISTS integration_account_links_active_idx ON integration_account_links (expires_at) WHERE consumed_at IS NULL;
COMMENT ON TABLE integration_account_links IS 'One-use verifier issued after a connector verifies a private user session; browser link redemption also requires an existing human session. Channel claims are unsupported. Secrets never persist.';
