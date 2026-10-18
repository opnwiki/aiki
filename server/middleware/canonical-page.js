import { getRequestURL, sendRedirect } from 'h3'
import { getHumanActor } from '../utils/auth.js'
import { queryDatabase } from '../utils/database.js'
import { readableTopicSql } from '../utils/page-access.js'
import { parsePageNumber } from '../utils/page-number.js'
import { isReservedSlug } from '../utils/validation.js'

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const url = getRequestURL(event)
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 1 || parts[0].includes('.')) return
  let slug = parts[0]
  try { slug = decodeURIComponent(slug) } catch { return }
  if (!slug || slug.length > 96 || parsePageNumber(slug) || isReservedSlug(slug)) return

  const viewer = await getHumanActor(event)
  const result = await queryDatabase(
    `SELECT page_number FROM topics WHERE lower(slug) = lower($1) AND ${readableTopicSql('topics', '$2')} LIMIT 1`,
    [slug, viewer?.id || null],
  )
  const pageNumber = result.rows[0]?.page_number
  if (pageNumber == null) return
  return sendRedirect(event, `/${pageNumber}${url.search}`, 301)
})
