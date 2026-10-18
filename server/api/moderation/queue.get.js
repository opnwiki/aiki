import { requireHumanActor } from '../../utils/auth.js'
import { queryDatabase } from '../../utils/database.js'
import { actorDisplayNameSql } from '../../utils/actor-display.js'

export default defineEventHandler(async (event) => {
  const actor = await requireHumanActor(event)
  const staff = ['owner', 'admin', 'moderator'].includes(actor.role)
  const items = await queryDatabase(
    `SELECT t.slug, t.kind, t.created_at, r.title, ${actorDisplayNameSql('a')} AS author
       FROM topics t
       JOIN topic_current_revisions current ON current.topic_id = t.id
       JOIN revisions r ON r.id = current.revision_id
       LEFT JOIN actors a ON a.id = t.author_id
      WHERE t.status = 'pending'
        AND t.author_id IS DISTINCT FROM $1::uuid
        AND (
          $2::boolean
          OR EXISTS (
            SELECT 1 FROM branch_roles duty
             WHERE duty.branch_id = t.branch_id
               AND duty.actor_id = $1::uuid
               AND duty.role IN ('leader', 'moderator')
          )
        )
      ORDER BY t.created_at ASC, t.slug ASC
      LIMIT 50`,
    [actor.id, staff],
  )
  return { items: items.rows }
})
