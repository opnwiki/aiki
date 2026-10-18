import { createError, readBody } from 'h3'
import { enforceSameOrigin, requireNodeAdmin } from '../../utils/auth.js'
import { getDatabase } from '../../utils/database.js'
import { DEFAULT_ACCENT_DARK, DEFAULT_ACCENT_LIGHT, normalizeAccent } from '../../utils/accent.js'
import { normalizeArticleRuleOverrides } from '../../utils/article-rules.js'
import { normalizeAssistantConfig, normalizeModerationMode } from '../../utils/moderation.js'
import { normalizeAgentProviderConfig } from '../../utils/agent-provider.js'
import { loadNodeFacts, normalizeDisplayName, presentNodeSettings, readBrandFavicon, readBrandIcon, setNodeBrand } from '../../utils/node-profile.js'
import { loadAccessControl, normalizeAccessSettings, presentAccessSettings, updateAccessSettings } from '../../utils/access-control.js'
import { ensureFederationSigningKey, federationConfigurationStatus, normalizeFederationSettings, updateFederationSettings } from '../../utils/federation-settings.js'
import { reloadFederationSigningKeys } from '../../federation.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireNodeAdmin(event)
  const input = await readBody(event)
  if (typeof input?.countsPublic !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'countsPublic must be true or false.' })
  }
  if (typeof input?.registrationOpen !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'registrationOpen must be true or false.' })
  }
  if (typeof input?.displayName !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'The node name needs 1–40 characters.' })
  }
  const name = normalizeDisplayName(input.displayName)
  if (!name.ok) throw createError({ statusCode: 400, statusMessage: name.message })
  if (input.clearIcon === true && input.icon != null) {
    throw createError({ statusCode: 400, statusMessage: 'Send either a new icon or a request to restore the default mark.' })
  }
  if (input.clearFavicon === true && input.favicon != null) {
    throw createError({ statusCode: 400, statusMessage: 'Send either a new app icon or a request to restore the default app icon.' })
  }
  const accentLight = normalizeAccent(input?.accentLight)
  const accentDark = normalizeAccent(input?.accentDark)
  if (!accentLight || !accentDark) {
    throw createError({ statusCode: 400, statusMessage: 'Accent colors must be #rrggbb values.' })
  }
  let moderationMode
  if (input.moderationMode !== undefined) {
    const mode = normalizeModerationMode(input.moderationMode)
    if (!mode.ok) throw createError({ statusCode: 400, statusMessage: mode.message })
    moderationMode = mode.value
  }
  let assistantConfig
  let assistantProvided = false
  let agentProviderConfig
  let agentProviderProvided = false
  const database = getDatabase()
  let accessSettings
  if (input.accessControl !== undefined) {
    const currentAccess = await loadAccessControl(database)
    const checked = normalizeAccessSettings(input.accessControl, currentAccess.settings)
    if (!checked.ok) throw createError({ statusCode: 400, statusMessage: checked.message })
    accessSettings = checked.value
  }
  if (input.assistant !== undefined) {
    const previous = await database.query(`SELECT assistant_moderation, agent_provider_config FROM nodes WHERE is_home LIMIT 1`)
    const checked = normalizeAssistantConfig(input.assistant, previous.rows[0]?.assistant_moderation)
    if (!checked.ok) throw createError({ statusCode: 400, statusMessage: checked.message })
    assistantConfig = checked.value
    assistantProvided = true
  }
  if (input.agentProvider !== undefined) {
    const previous = await database.query(`SELECT agent_provider_config FROM nodes WHERE is_home LIMIT 1`)
    const checked = normalizeAgentProviderConfig(input.agentProvider, previous.rows[0]?.agent_provider_config, useRuntimeConfig())
    if (!checked.ok) throw createError({ statusCode: 400, statusMessage: checked.message })
    agentProviderConfig = checked.value
    agentProviderProvided = true
  }
  let articleRuleOverrides
  if (input.articleRules !== undefined) {
    const rules = normalizeArticleRuleOverrides(input.articleRules)
    if (!rules.ok) throw createError({ statusCode: 400, statusMessage: rules.message })
    articleRuleOverrides = rules.value
  }
  let federationSettings
  if (input.federation !== undefined) {
    const current = await database.query(`SELECT federation_enabled, federation_mode FROM nodes WHERE is_home LIMIT 1`)
    const checked = normalizeFederationSettings(input.federation, current.rows[0])
    if (!checked.ok) throw createError({ statusCode: 400, statusMessage: checked.message })
    if (checked.value.enabled) {
      try {
        await ensureFederationSigningKey()
        await reloadFederationSigningKeys()
      } catch (error) {
        throw createError({ statusCode: 409, statusMessage: `Fediverse signing key is unavailable: ${error instanceof Error ? error.message : String(error)}` })
      }
      const readiness = federationConfigurationStatus()
      if (!readiness.ready) throw createError({ statusCode: 409, statusMessage: `Fediverse is not ready: ${readiness.reasons.join(', ')}.` })
    }
    federationSettings = checked.value
  }
  let icon = null
  if (input.icon != null) {
    const parsed = readBrandIcon(input.icon)
    if (!parsed.ok) throw createError({ statusCode: 400, statusMessage: parsed.message })
    icon = parsed.value
  }
  let favicon = null
  if (input.favicon != null) {
    const parsed = readBrandFavicon(input.favicon)
    if (!parsed.ok) throw createError({ statusCode: 400, statusMessage: parsed.message })
    favicon = parsed.value
  }

  const client = await database.connect()
  try {
    await client.query('BEGIN')
    await setNodeBrand(client, {
      actorId: actor.id,
      countsPublic: input.countsPublic,
      displayName: name.value,
      icon,
      clearIcon: input.clearIcon === true,
      favicon,
      clearFavicon: input.clearFavicon === true,
      accentLight: accentLight === DEFAULT_ACCENT_LIGHT ? null : accentLight,
      accentDark: accentDark === DEFAULT_ACCENT_DARK ? null : accentDark,
      registrationOpen: input.registrationOpen,
      articleRuleOverrides,
      moderationMode,
    })
    if (accessSettings) await updateAccessSettings(client, accessSettings)
    if (assistantProvided) {
      await client.query(
        `UPDATE nodes SET assistant_moderation = $1::jsonb WHERE is_home`,
        [assistantConfig ? JSON.stringify(assistantConfig) : null],
      )
    }
    if (agentProviderProvided) {
      await client.query(
        `UPDATE nodes SET agent_provider_config = $1::jsonb WHERE is_home`,
        [JSON.stringify(agentProviderConfig)],
      )
    }
    if (federationSettings) await updateFederationSettings(client, { actorId: actor.id, settings: federationSettings })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  const facts = await loadNodeFacts(database)
  const access = await loadAccessControl(database)
  return {
    settings: { ...presentNodeSettings(facts, useRuntimeConfig()), accessControl: presentAccessSettings(access) },
  }
})
