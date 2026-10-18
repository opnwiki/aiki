-- AIKI Cloud credentials are obtained by the instance/cloud handshake. Do not
-- retain legacy administrator-entered service tokens in node configuration.
UPDATE nodes
   SET agent_provider_config = agent_provider_config - 'serviceToken'
 WHERE agent_provider_config ? 'serviceToken';
