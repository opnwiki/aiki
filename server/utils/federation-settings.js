import { ensureFederationSigningKey, hasUsableFederationKey, readFederationKeyPayload } from './federation-keys.js'

export const FEDERATION_MODES = ['open', 'inbound_only', 'outbound_only', 'paused']

export function normalizeFederationSettings(input, current = {}) {
  if (input === undefined) return { ok: true, provided: false, value: currentFederationSettings(current) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'Federation settings must be an object.' }
  }
  if (typeof input.enabled !== 'boolean') {
    return { ok: false, message: 'Federation enabled must be true or false.' }
  }
  const mode = typeof input.mode === 'string' ? input.mode.trim() : 'open'
  if (!FEDERATION_MODES.includes(mode)) {
    return { ok: false, message: 'Federation mode is invalid.' }
  }
  return {
    ok: true,
    provided: true,
    value: { enabled: input.enabled, mode: input.enabled ? mode : 'paused' },
  }
}

export function currentFederationSettings(row = {}) {
  const enabled = row.federation_enabled === true || row.federationEnabled === true || row.enabled === true
  const rawMode = row.federation_mode || row.federationMode
  const mode = FEDERATION_MODES.includes(rawMode) ? rawMode : 'open'
  return { enabled, mode: enabled ? mode : 'paused' }
}

export function presentFederationSettings(facts = {}) {
  const current = currentFederationSettings(facts)
  const readiness = federationConfigurationStatus()
  return {
    ...current,
    pausedAt: facts.federationPausedAt || null,
    lastError: facts.federationLastError || null,
    ready: readiness.ready,
    readiness: readiness.reasons,
    actorBasePath: '/ap/actors',
    importPath: '/api/federation/import',
  }
}

export function federationConfigurationStatus(env = process.env) {
  const origin = env.NUXT_PUBLIC_SITE_URL || env.SITE_URL || ''
  const hasKey = hasUsableFederationKey(env)
  const reasons = []
  try {
    const url = new URL(origin)
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:') reasons.push('canonical_origin_must_use_https')
  } catch {
    reasons.push('canonical_origin_is_invalid')
  }
  if (env.NODE_ENV === 'production' && !hasKey) reasons.push('signing_key_is_missing')
  return { ready: reasons.length === 0, reasons }
}

export { ensureFederationSigningKey, readFederationKeyPayload }

export async function updateFederationSettings(client, { actorId, settings }) {
  const result = await client.query(
    `UPDATE nodes
        SET federation_enabled = $1::boolean,
            federation_mode = $2::text,
            federation_paused_at = CASE WHEN $1::boolean THEN NULL ELSE COALESCE(federation_paused_at, now()) END,
            federation_last_error = CASE WHEN $1::boolean THEN NULL ELSE federation_last_error END
      WHERE is_home
      RETURNING id, federation_enabled, federation_mode, federation_paused_at, federation_last_error`,
    [settings.enabled, settings.mode],
  )
  const node = result.rows[0]
  if (!node) throw new Error('This node has no home record to update.')
  if (settings.enabled && settings.mode !== 'inbound_only' && settings.mode !== 'paused') {
    await client.query(
      `UPDATE federation_reply_deliveries
          SET state = 'queued', next_attempt_at = now(), updated_at = now(), last_error = NULL
        WHERE topic_id IN (
          SELECT id FROM topics
           WHERE node_id = $1 AND discussion_enabled = true
             AND accept_replies = true AND federation_outbound_mode = 'auto'
        ) AND state = 'paused'`,
      [node.id],
    )
    await client.query(
      `UPDATE replies SET federation_delivery_state = 'queued'
        WHERE topic_id IN (
          SELECT id FROM topics
           WHERE node_id = $1 AND discussion_enabled = true
             AND accept_replies = true AND federation_outbound_mode = 'auto'
        ) AND federation_delivery_state = 'paused'`,
      [node.id],
    )
  } else {
    await client.query(
      `UPDATE federation_reply_deliveries SET state = 'paused', updated_at = now()
        WHERE topic_id IN (SELECT id FROM topics WHERE node_id = $1) AND state IN ('queued', 'retry')`,
      [node.id],
    )
    await client.query(
      `UPDATE replies SET federation_delivery_state = 'paused'
        WHERE topic_id IN (SELECT id FROM topics WHERE node_id = $1) AND federation_delivery_state IN ('queued', 'retry')`,
      [node.id],
    )
  }
  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
     VALUES ($1::uuid, 'node_federation_settings_updated', 'node', $2::text,
             jsonb_build_object('enabled', $3::boolean, 'mode', $4::text))`,
    [actorId, node.id, node.federation_enabled, node.federation_mode],
  )
  return node
}

export function federationAllowsInbound(settings) {
  return settings?.enabled === true && settings.mode !== 'outbound_only' && settings.mode !== 'paused'
}

export function federationAllowsOutbound(settings) {
  return settings?.enabled === true && settings.mode !== 'inbound_only' && settings.mode !== 'paused'
}
