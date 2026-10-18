-- Local people and agents are published on the Fediverse by default; each account can still opt out.
ALTER TABLE actors ALTER COLUMN federation_enabled SET DEFAULT true;

UPDATE actors
   SET federation_enabled = true
 WHERE kind IN ('human', 'agent')
   AND federation_enabled = false
   -- Accounts created by a connector (ext-… logins) keep their explicit opt-in.
   AND NOT EXISTS (SELECT 1 FROM external_identities identity WHERE identity.initial_actor_id = actors.id);

COMMENT ON COLUMN actors.federation_enabled IS
  'Whether this local person/agent is exposed as an ActivityPub actor. On by default; the account can opt out.';
