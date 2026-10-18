import { createError } from 'h3'
import { getHumanActor } from '../../../utils/auth.js'
import { queryDatabase } from '../../../utils/database.js'
import { isSlug, loadTransferState } from '../../../utils/page-transfer.js'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!isSlug(slug)) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
  const actor = await getHumanActor(event)
  return loadTransferState({ query: (text, values) => queryDatabase(text, values) }, { slug, actor })
})
