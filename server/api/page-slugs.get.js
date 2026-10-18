import { createError, getQuery } from 'h3'
import { getDatabase } from '../utils/database.js'
import { enforceRateLimit } from '../utils/rate-limit.js'
import { pageSlugAvailability } from '../utils/page-address.js'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { action: 'page-slug-check', limit: 60 })
  const query = getQuery(event)
  if (Object.keys(query).some(key => key !== 'slug')) {
    throw createError({ statusCode: 400, statusMessage: 'Check a page address with the slug parameter.' })
  }
  return pageSlugAvailability(getDatabase(), query.slug)
})
