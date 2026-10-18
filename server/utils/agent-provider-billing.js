import { DEFAULT_AIKI_CLOUD_ENDPOINT } from './agent-provider.js'

const SAFE_STATUS = new Set(['available', 'unavailable', 'not_configured', 'unsupported'])

export async function readAgentProviderBilling(database, runtimeConfig = {}, fetchImpl = globalThis.fetch) {
  const result = await database.query('SELECT agent_provider_config FROM nodes WHERE is_home LIMIT 1')
  const stored = result.rows[0]?.agent_provider_config || { mode: 'disabled' }
  const mode = ['disabled', 'neron', 'aiki_cloud', 'custom'].includes(stored?.mode) ? stored.mode : 'disabled'

  if (mode === 'disabled') return presentBilling({ mode, ticker: null, balance: null, status: 'not_configured' })
  if (mode === 'custom') return presentBilling({ mode, ticker: null, balance: null, status: 'unsupported' })

  if (mode === 'neron') {
    // Neron's balance endpoint is intentionally not guessed. The provider
    // contract must be fixed from its documentation before a secret-bearing
    // server-side request is enabled.
    return presentBilling({ mode, ticker: 'NAI', balance: null, status: 'not_configured' })
  }

  const endpoint = cleanUrl(runtimeConfig.aikiCloudApiBase) || DEFAULT_AIKI_CLOUD_ENDPOINT
  const path = cleanPath(runtimeConfig.aikiCloudBillingPath || '/billing')
  const nodeDomain = cleanLine(runtimeConfig.public?.nodeDomain || runtimeConfig.nodeDomain, 255)
  const nodeUrl = cleanUrl(runtimeConfig.public?.siteUrl || runtimeConfig.siteUrl)
  try {
    const response = await fetchImpl(`${endpoint}${path}`, {
      method: 'GET',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        ...(nodeDomain ? { 'x-aiki-node-domain': nodeDomain } : {}),
        ...(nodeUrl ? { 'x-aiki-node-url': nodeUrl } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    })
    const text = await response.text()
    let payload = null
    try { payload = text ? JSON.parse(text) : null } catch { /* normalized below */ }
    if (!response.ok || !payload) return presentBilling({ mode, ticker: 'WPG', balance: null, status: 'unavailable' })
    return presentBilling({ mode, ...parseCloudBilling(payload) })
  } catch {
    return presentBilling({ mode, ticker: 'WPG', balance: null, status: 'unavailable' })
  }
}

export function parseCloudBilling(payload) {
  const account = payload?.account && typeof payload.account === 'object' ? payload.account : {}
  const balanceObject = payload?.balance && typeof payload.balance === 'object' ? payload.balance : {}
  const rawBalance = payload?.wpg?.balance
    ?? balanceObject.amount
    ?? balanceObject.value
    ?? payload?.balance
    ?? account.wpgBalance
    ?? account.balance
  const balance = parseNonNegativeInteger(rawBalance)
  const ticker = String(payload?.ticker || balanceObject.ticker || payload?.wpg?.ticker || 'WPG').trim().toUpperCase()
  const topUpUrl = safeHttpsUrl(payload?.topUpUrl || payload?.top_up_url || account.topUpUrl)
  if (ticker !== 'WPG') return { ticker: 'WPG', balance: null, status: 'unavailable' }
  return {
    ticker: 'WPG',
    balance,
    status: balance === null ? 'unavailable' : 'available',
    ...(topUpUrl ? { topUpUrl } : {}),
  }
}

function presentBilling({ mode, ticker, balance, status, topUpUrl }) {
  return {
    mode,
    ticker: ticker || null,
    balance: Number.isSafeInteger(balance) && balance >= 0 ? balance : null,
    status: SAFE_STATUS.has(status) ? status : 'unavailable',
    ...(topUpUrl ? { topUpUrl } : {}),
  }
}

function parseNonNegativeInteger(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

function safeHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function cleanUrl(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
}

function cleanPath(value) {
  const path = typeof value === 'string' ? value.trim() : '/billing'
  return `/${path.replace(/^\/+/, '')}`
}

function cleanLine(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max)
}
