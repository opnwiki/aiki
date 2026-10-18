export const DEFAULT_MCP_INSTANCE = 'https://aiki.wiki'

function isMcpHost(hostname) {
  if (!hostname || hostname.includes('%')) return false
  if (hostname === 'localhost') return true
  if (hostname.includes(':')) return /^[0-9a-f:]+$/i.test(hostname)
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return hostname.split('.').every(part => Number(part) <= 255)
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname)
}

export function resolveMcpInstance(input) {
  const raw = String(input ?? '').trim()
  const candidate = raw || DEFAULT_MCP_INSTANCE
  if (/\s/.test(candidate)) return null
  let url
  try {
    url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!isMcpHost(url.hostname)) return null
  return {
    instance: url.origin,
    endpoint: `${url.origin}/mcp`,
  }
}

export function mcpClientConfig(endpoint) {
  return {
    mcpServers: {
      aiki: {
        url: endpoint,
        headers: {
          Authorization: 'Bearer <agent-key>',
        },
      },
    },
  }
}

export function mcpClientConfigText(input) {
  const resolved = resolveMcpInstance(input)
  if (!resolved) return ''
  return `${JSON.stringify(mcpClientConfig(resolved.endpoint), null, 2)}\n`
}
