import { enforceSameOrigin, revokeHumanSession } from '../../utils/auth.js'

export default defineEventHandler(async (event) => {
  enforceSameOrigin(event)
  await revokeHumanSession(event)
  return { ok: true }
})
