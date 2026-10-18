import { createError, setResponseHeader } from 'h3'
import { DEFAULT_ACCENT_DARK, DEFAULT_ACCENT_LIGHT, resolveAccent } from './accent.js'
import { PRODUCT_VERSION } from './release.js'
import { presentAssistantConfig } from './moderation.js'
import { presentAgentProviderConfig } from './agent-provider.js'
import { presentFederationSettings } from './federation-settings.js'

export const SOURCE_REPOSITORY = 'https://github.com/opnwiki/aiki'
export const DEFAULT_BRAND_NAME = 'AiKi'
export const BRAND_ICON_LIMIT = 512_000

export function publicNodeProfile({ domain, countsPublic, pages, users, agents = 0, online24h = 0, displayName, iconVersion, faviconVersion, accentLight, accentDark, registrationOpen, moderationMode, contactUrl, federationEnabled = false, federationMode = 'paused' }) {
  const visible = countsPublic === true
  return {
    domain,
    repository: SOURCE_REPOSITORY,
    contactUrl: typeof contactUrl === 'string' && contactUrl.trim() ? contactUrl.trim() : null,
    displayName: shownBrandName(displayName),
    iconUrl: iconVersion ? `/api/node-icon?v=${iconVersion}` : null,
    faviconUrl: faviconVersion ? `/api/node-favicon?v=${faviconVersion}` : null,
    countsPublic: visible,
    pages: visible ? pages : null,
    users: visible ? users : null,
    agents: visible ? agents : null,
    online24h: Number.isInteger(online24h) && online24h >= 0 ? online24h : 0,
    accentLight: resolveAccent(accentLight, DEFAULT_ACCENT_LIGHT),
    accentDark: resolveAccent(accentDark, DEFAULT_ACCENT_DARK),
    registrationOpen: registrationOpen !== false,
    moderationMode: moderationMode === 'manual' ? 'manual' : 'community',
    federation: { enabled: federationEnabled === true, mode: federationEnabled === true ? federationMode : 'paused' },
    version: PRODUCT_VERSION,
  }
}

export function shownBrandName(value) {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return name || DEFAULT_BRAND_NAME
}

export function normalizeDisplayName(value) {
  if (typeof value !== 'string') return { ok: false, message: 'The node name needs 1–40 characters.' }
  const name = value.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  if (!name) return { ok: true, value: null }
  if (name.length > 40) return { ok: false, message: 'The node name needs 1–40 characters.' }
  return { ok: true, value: name }
}

const HEADER_ICON_MESSAGE = 'Use an SVG, PNG, JPEG, or WebP icon up to 512 KB.'
const FAVICON_MESSAGE = 'Use a PNG, JPEG, or WebP icon up to 512 KB.'

export function readBrandIcon(value) {
  return readImageDataUrl(value, { allowSvg: true, message: HEADER_ICON_MESSAGE })
}

export function readBrandFavicon(value) {
  return readImageDataUrl(value, { allowSvg: false, message: FAVICON_MESSAGE })
}

function readImageDataUrl(value, { allowSvg, message }) {
  if (value == null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string' || value.length > 800_000) return { ok: false, message }
  const match = value.match(/^data:(image\/(?:png|jpeg|webp|svg\+xml))(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i)
  if (!match) return { ok: false, message }
  const type = match[1].toLowerCase()
  if (type === 'image/svg+xml') {
    if (!allowSvg) return { ok: false, message }
    const clean = sanitizeSvg(Buffer.from(match[2].replace(/\s/g, ''), 'base64').toString('utf8'))
    if (!clean) return { ok: false, message }
    const bytes = Buffer.from(clean, 'utf8')
    if (!bytes.length || bytes.length > BRAND_ICON_LIMIT) return { ok: false, message }
    return { ok: true, value: { bytes, type } }
  }
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (!bytes.length || bytes.length > BRAND_ICON_LIMIT || sniffImageType(bytes) !== type) {
    return { ok: false, message }
  }
  return { ok: true, value: { bytes, type } }
}

export function sanitizeSvg(source) {
  const text = String(source || '').replace(/^\uFEFF/, '').trim()
  if (!text || text.length > BRAND_ICON_LIMIT) return null
  if (!/^<svg[\s>]/i.test(text) || !/<\/svg>\s*$/i.test(text)) return null
  const withoutNamespace = text.replace(/\sxmlns(?::[A-Za-z0-9]+)?\s*=\s*["']https?:\/\/www\.w3\.org\/[^"']+["']/gi, '')
  if (/<!DOCTYPE|<!ENTITY|<script|<foreignObject|<iframe|<embed|<object|<use[\s/>]|javascript:|https?:/i.test(withoutNamespace)) return null
  if (/[\s/]on[a-z]+\s*=/i.test(text)) return null
  return text
}

export function sniffImageType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

export async function loadNodeFacts(client) {
  const result = await client.query(
    `SELECT
        (SELECT id FROM nodes WHERE is_home LIMIT 1) AS node_id,
        COALESCE((SELECT show_public_counts FROM nodes WHERE is_home LIMIT 1), true) AS counts_public,
        (SELECT display_name FROM nodes WHERE is_home LIMIT 1) AS display_name,
        (SELECT accent_light FROM nodes WHERE is_home LIMIT 1) AS accent_light,
        (SELECT accent_dark FROM nodes WHERE is_home LIMIT 1) AS accent_dark,
        (SELECT md5(brand_icon) FROM nodes WHERE is_home AND brand_icon IS NOT NULL LIMIT 1) AS icon_version,
        (SELECT md5(brand_favicon) FROM nodes WHERE is_home AND brand_favicon IS NOT NULL LIMIT 1) AS favicon_version,
        (SELECT brand_favicon_type FROM nodes WHERE is_home LIMIT 1) AS favicon_type,
        COALESCE((SELECT registration_open FROM nodes WHERE is_home LIMIT 1), true) AS registration_open,
        COALESCE((SELECT article_rule_overrides FROM nodes WHERE is_home LIMIT 1), '[]'::jsonb) AS article_rule_overrides,
        COALESCE((SELECT moderation_mode FROM nodes WHERE is_home LIMIT 1), 'community') AS moderation_mode,
        (SELECT assistant_moderation FROM nodes WHERE is_home LIMIT 1) AS assistant_moderation,
        (SELECT agent_provider_config FROM nodes WHERE is_home LIMIT 1) AS agent_provider_config,
        COALESCE((SELECT federation_enabled FROM nodes WHERE is_home LIMIT 1), false) AS federation_enabled,
        COALESCE((SELECT federation_mode FROM nodes WHERE is_home LIMIT 1), 'paused') AS federation_mode,
        (SELECT federation_paused_at FROM nodes WHERE is_home LIMIT 1) AS federation_paused_at,
        (SELECT federation_last_error FROM nodes WHERE is_home LIMIT 1) AS federation_last_error,
        (SELECT count(*)::int FROM topics WHERE status = 'published') AS pages,
        (SELECT count(*)::int FROM actors WHERE kind = 'human' AND account_status = 'active') AS users,
        (SELECT count(*)::int FROM actors WHERE kind = 'agent' AND account_status = 'active') AS agents`,
  )
  const row = result.rows[0]
  return {
    nodeId: row.node_id,
    countsPublic: row.counts_public === true,
    displayName: row.display_name || null,
    accentLight: row.accent_light || null,
    accentDark: row.accent_dark || null,
    iconVersion: row.icon_version || null,
    faviconVersion: row.favicon_version || null,
    faviconType: row.favicon_type || null,
    registrationOpen: row.registration_open !== false,
    articleRuleOverrides: Array.isArray(row.article_rule_overrides) ? row.article_rule_overrides : [],
    moderationMode: row.moderation_mode === 'manual' ? 'manual' : 'community',
    assistantModeration: row.assistant_moderation || null,
    agentProviderConfig: row.agent_provider_config || { mode: 'disabled' },
    federationEnabled: row.federation_enabled === true,
    federationMode: row.federation_mode || 'paused',
    federationPausedAt: row.federation_paused_at || null,
    federationLastError: row.federation_last_error || null,
    pages: row.pages,
    users: row.users,
    agents: row.agents,
  }
}

export function presentNodeSettings(facts, runtimeConfig = {}) {
  return {
    countsPublic: facts.countsPublic,
    displayName: shownBrandName(facts.displayName),
    iconUrl: facts.iconVersion ? `/api/node-icon?v=${facts.iconVersion}` : null,
    faviconUrl: facts.faviconVersion ? `/api/node-favicon?v=${facts.faviconVersion}` : null,
    accentLight: resolveAccent(facts.accentLight, DEFAULT_ACCENT_LIGHT),
    accentDark: resolveAccent(facts.accentDark, DEFAULT_ACCENT_DARK),
    pages: facts.pages,
    users: facts.users,
    agents: facts.agents,
    registrationOpen: facts.registrationOpen !== false,
    articleRules: Array.isArray(facts.articleRuleOverrides) ? facts.articleRuleOverrides : [],
    moderationMode: facts.moderationMode === 'manual' ? 'manual' : 'community',
    assistant: presentAssistantConfig(facts.assistantModeration),
    agentProvider: presentAgentProviderConfig(facts.agentProviderConfig, runtimeConfig),
    federation: presentFederationSettings(facts),
  }
}

export async function setNodeBrand(client, { actorId, countsPublic, displayName, icon, clearIcon, favicon, clearFavicon, accentLight, accentDark, registrationOpen, articleRuleOverrides, moderationMode }) {
  const updated = await client.query(
    `UPDATE nodes
        SET show_public_counts = $1,
            display_name = $2,
            accent_light = $6,
            accent_dark = $7,
            registration_open = $8,
            article_rule_overrides = CASE WHEN $9::boolean THEN $10::jsonb ELSE article_rule_overrides END,
            moderation_mode = CASE WHEN $11::boolean THEN $12 ELSE moderation_mode END,
            brand_icon = CASE WHEN $3::boolean THEN $4::bytea ELSE brand_icon END,
            brand_icon_type = CASE WHEN $3::boolean THEN $5 ELSE brand_icon_type END,
            brand_favicon = CASE WHEN $13::boolean THEN $14::bytea ELSE brand_favicon END,
            brand_favicon_type = CASE WHEN $13::boolean THEN $15 ELSE brand_favicon_type END
      WHERE is_home
      RETURNING id, show_public_counts, display_name, registration_open, moderation_mode`,
    [countsPublic, displayName, Boolean(icon || clearIcon), icon?.bytes || null, icon?.type || null, accentLight, accentDark, registrationOpen !== false, articleRuleOverrides !== undefined, articleRuleOverrides ? JSON.stringify(articleRuleOverrides) : '[]', moderationMode === 'community' || moderationMode === 'manual', moderationMode === 'manual' ? 'manual' : 'community', Boolean(favicon || clearFavicon), favicon?.bytes || null, favicon?.type || null],
  )
  const node = updated.rows[0]
  if (!node) {
    throw createError({ statusCode: 409, statusMessage: 'This node has no home record to update.' })
  }
  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
     VALUES ($1::uuid, 'node_brand_updated', 'node', $2::text, jsonb_build_object('countsPublic', $3::boolean, 'displayName', $4::text, 'iconChanged', $5::boolean, 'faviconChanged', $6::boolean, 'accentLight', $7::text, 'accentDark', $8::text, 'registrationOpen', $9::boolean, 'moderationMode', $10::text))`,
    [actorId, node.id, node.show_public_counts, node.display_name, Boolean(icon || clearIcon), Boolean(favicon || clearFavicon), accentLight, accentDark, node.registration_open, node.moderation_mode],
  )
  return { nodeId: node.id }
}

export function presentStoredImage(event, { bytes, type, missing }) {
  if (!bytes || !type) throw createError({ statusCode: 404, statusMessage: missing })
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  setResponseHeader(event, 'Content-Type', type)
  setResponseHeader(event, 'Cache-Control', 'public, max-age=86400')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  if (type === 'image/svg+xml') {
    setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'")
  }
  return body
}

export function presentWebManifest(base, facts) {
  const manifest = { ...base, icons: (base.icons || []).map(icon => ({ ...icon })) }
  if (!facts?.faviconVersion) return manifest
  const src = `/api/node-favicon?v=${facts.faviconVersion}`
  const type = facts.faviconType || 'image/png'
  manifest.icons = [
    { src, sizes: 'any', type, purpose: 'any' },
    { src, sizes: 'any', type, purpose: 'maskable' },
  ]
  return manifest
}
