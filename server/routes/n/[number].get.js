import { createError, getRouterParam, sendRedirect } from 'h3'
import { getHumanActor } from '../../utils/auth.js'
import { queryDatabase } from '../../utils/database.js'
import { parsePageNumber } from '../../utils/page-number.js'
import { readableTopicSql } from '../../utils/page-access.js'

export default defineEventHandler(async (event) => {
  const pageNumber = parsePageNumber(getRouterParam(event, 'number'))
  if (!pageNumber) throw createError({ statusCode: 404, statusMessage: 'Page not found' })

  const viewer = await getHumanActor(event)
  const result = await queryDatabase(
    `SELECT page_number FROM topics WHERE page_number = $1::bigint AND ${readableTopicSql('topics', '$2')}`,
    [pageNumber, viewer?.id || null],
  )
  if (!result.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Page not found' })
  return sendRedirect(event, `/${pageNumber}`, 301)
})
