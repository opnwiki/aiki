import { createError, getRequestURL, sendRedirect, setResponseHeader } from 'h3'
import { accessDeniedData, evaluateAccess, isAccessControlExempt } from '../utils/access-control.js'

export default defineEventHandler(async (event) => {
  if (isAccessControlExempt(event)) return

  let decision
  try {
    decision = await evaluateAccess(event)
  } catch {
    // Access controls must not turn a temporary database or Statica failure
    // into a total outage. The next request retries the decision.
    return
  }
  if (!decision.blocked) return

  setResponseHeader(event, 'cache-control', 'no-store')
  const path = getRequestURL(event).pathname || '/'
  const acceptsHtml = String(event.node.req.headers.accept || '').includes('text/html')
  if (['GET', 'HEAD'].includes(event.method) && acceptsHtml && !path.startsWith('/api/')) {
    return sendRedirect(event, `/access-denied?from=${encodeURIComponent(path)}`, 302)
  }
  throw createError({ statusCode: 403, statusMessage: 'Access denied', data: accessDeniedData(decision) })
})
