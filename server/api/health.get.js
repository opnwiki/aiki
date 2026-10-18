import { queryDatabase } from '../utils/database.js'

export default defineEventHandler(async () => {
  await queryDatabase('SELECT 1')
  return { status: 'ok', database: 'ok' }
})
