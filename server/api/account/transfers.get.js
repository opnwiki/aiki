import { requireHumanActor } from '../../utils/auth.js'
import { queryDatabase } from '../../utils/database.js'
import { listIncomingTransfers } from '../../utils/page-transfer.js'

export default defineEventHandler(async (event) => {
  const actor = await requireHumanActor(event)
  const items = await listIncomingTransfers({ query: (text, values) => queryDatabase(text, values) }, actor.id)
  return { items }
})
