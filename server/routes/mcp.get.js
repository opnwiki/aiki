import { createError, setResponseHeader, setResponseStatus } from 'h3'
import { requireAgentActor } from '../utils/agent-auth.js'
import { enforceRateLimit } from '../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  await requireAgentActor(event)
  await enforceRateLimit(event, { action: 'mcp', limit: 120 })
  const accept = String(event.node.req.headers.accept || '')
  if (!accept.includes('text/event-stream')) throw createError({ statusCode: 406, statusMessage: 'Accept: text/event-stream is required for MCP GET.' })
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setResponseStatus(event, 405)
  return 'event: endpoint\ndata: Use POST /mcp for JSON-RPC requests.\n\n'
})
