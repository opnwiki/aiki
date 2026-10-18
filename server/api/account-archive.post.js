import { createError, getRequestHeader, readBody, readMultipartFormData } from 'h3'
import { enforceSameOrigin, requireHumanActor } from '../utils/auth.js'
import { ARCHIVE_BYTE_LIMIT, importAccountArchive } from '../utils/archive.js'
import { getDatabase } from '../utils/database.js'
import { enforceRateLimit } from '../utils/rate-limit.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  const actor = await requireHumanActor(event)
  await enforceRateLimit(event, { action: 'account-import', limit: 5 })
  const archive = await readArchive(event)
  const client = await getDatabase().connect()
  try {
    return await importAccountArchive(client, actor, archive)
  } finally {
    client.release()
  }
})

async function readArchive(event) {
  const type = String(getRequestHeader(event, 'content-type') || '')
  if (type.includes('application/json')) {
    const body = await readBody(event)
    const archive = body?.aiki ? body : body?.archive
    if (!archive || typeof archive !== 'object') throw createError({ statusCode: 400, statusMessage: 'Upload an AIKI account archive.' })
    if (Buffer.byteLength(JSON.stringify(archive)) > ARCHIVE_BYTE_LIMIT) {
      throw createError({ statusCode: 413, statusMessage: 'That archive is too large to import.' })
    }
    return archive
  }

  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' || part.name === 'archive')
  if (!file?.data?.length) throw createError({ statusCode: 400, statusMessage: 'Upload an AIKI account archive.' })
  if (file.data.length > ARCHIVE_BYTE_LIMIT) throw createError({ statusCode: 413, statusMessage: 'That archive is too large to import.' })
  try {
    const parsed = JSON.parse(file.data.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'The archive file is not valid JSON.' })
  }
}
