import { getDatabase } from '../utils/database.js'
import { presentStoredImage } from '../utils/node-profile.js'

export default defineEventHandler(async (event) => {
  const result = await getDatabase().query(
    `SELECT brand_icon, brand_icon_type
       FROM nodes
      WHERE is_home AND brand_icon IS NOT NULL
      LIMIT 1`,
  )
  const row = result.rows[0]
  return presentStoredImage(event, {
    bytes: row?.brand_icon,
    type: row?.brand_icon_type,
    missing: 'This node uses the default mark.',
  })
})
