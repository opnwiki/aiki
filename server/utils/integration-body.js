import { createError } from 'h3'
import { IMPORT_BODY_BYTES } from './integration-import-validation.js'

export async function readIntegrationBody(event) {
  const type = String(event.node.req.headers['content-type'] || '').split(';')[0].trim()
  if (type !== 'application/json') throw createError({ statusCode: 415, statusMessage: 'Send application/json.' })
  if (Number(event.node.req.headers['content-length']) > IMPORT_BODY_BYTES) throw createError({ statusCode: 413, statusMessage: 'The import is too large.' })
  const chunks = []
  let length = 0
  for await (const part of event.node.req) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part)
    length += chunk.length
    if (length > IMPORT_BODY_BYTES) throw createError({ statusCode: 413, statusMessage: 'The import is too large.' })
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON.' })
  }
}
