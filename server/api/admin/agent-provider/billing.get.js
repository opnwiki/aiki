import { requireNodeAdmin } from '../../../utils/auth.js'
import { getDatabase } from '../../../utils/database.js'
import { readAgentProviderBilling } from '../../../utils/agent-provider-billing.js'

export default defineEventHandler(async (event) => {
  await requireNodeAdmin(event)
  const billing = await readAgentProviderBilling(getDatabase(), useRuntimeConfig())
  return { billing }
})
