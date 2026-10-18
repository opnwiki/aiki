import { toWebRequest } from 'h3'
import { federation } from '../federation.js'

const FEDIVERSE_PATH = /^\/(?:\.well-known\/(?:webfinger|nodeinfo)|ap(?:\/|$))/i

export default defineEventHandler(async (event) => {
  const path = String(event.path || '').split('?')[0]
  if (!FEDIVERSE_PATH.test(path)) return

  const response = await federation.fetch(toWebRequest(event))
  if (response?.status === 404) return
  return response
})
