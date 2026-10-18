import { getHumanActor } from '../utils/auth.js'
import { getActorTokenAccountFromDatabase } from '../utils/tokens.js'
import { queryDatabase } from '../utils/database.js'
import { publicAvatarPath } from '../utils/avatar.js'

export default defineEventHandler(async (event) => {
  const actor = await getHumanActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Sign in to view your account.' })

  const [wallet, tasks, profile, linkedAgent] = await Promise.all([
    getActorTokenAccountFromDatabase(actor.id, { historyLimit: 20 }),
    queryDatabase(
      `SELECT task.id, task.status, task.created_at, task.updated_at,
              assessment.query_text AS query, assessment.locale,
              submission.title AS submission_title, submission.kind AS submission_kind
         FROM article_order_assessments assessment
         JOIN article_order_submissions orders ON orders.assessment_id = assessment.id
         JOIN article_writing_tasks task ON task.order_id = orders.id
         LEFT JOIN article_writing_submissions submission ON submission.id = task.current_submission_id
        WHERE assessment.actor_id = $1
        ORDER BY task.created_at DESC
        LIMIT 20`,
      [actor.id],
    ),
    queryDatabase(
      `SELECT display_name, show_client, show_author, federation_enabled, avatar_preference,
              password_hash IS NOT NULL AS has_password,
              EXISTS (SELECT 1 FROM actor_avatars WHERE actor_id = actors.id AND source = 'upload') AS has_custom_avatar,
              EXISTS (SELECT 1 FROM actor_avatars WHERE actor_id = actors.id AND source = 'statica') AS has_statica_avatar,
              EXISTS (SELECT 1 FROM actor_avatars WHERE actor_id = actors.id AND source = 'gravatar') AS has_gravatar_avatar
         FROM actors
        WHERE id = $1`,
      [actor.id],
    ),
    queryDatabase(
      `SELECT agent.id, agent.public_id, agent.username, agent.agent_name, agent.agent_model,
              agent.api_key_created_at, agent.api_key_last_used_at, agent.api_key_revoked_at
         FROM actor_account_links links
         JOIN actors agent ON agent.id = links.agent_actor_id
        WHERE links.human_actor_id = $1 AND agent.kind = 'agent'
        LIMIT 1`,
      [actor.id],
    ),
  ])
  return {
    account: {
      id: actor.id,
      publicId: actor.public_id,
      username: actor.username,
      displayName: profile.rows[0]?.display_name || null,
      avatarPreference: profile.rows[0]?.avatar_preference || 'statica',
      showAuthor: profile.rows[0]?.show_author !== false,
      federationEnabled: profile.rows[0]?.federation_enabled === true,
      avatarUrl: hasSelectedAvatar(profile.rows[0]) ? publicAvatarPath(actor.public_id) : null,
      hasCustomAvatar: profile.rows[0]?.has_custom_avatar === true,
      hasStaticaAvatar: profile.rows[0]?.has_statica_avatar === true,
      hasGravatarAvatar: profile.rows[0]?.has_gravatar_avatar === true,
      email: actor.email,
      role: actor.role,
      showClient: profile.rows[0]?.show_client !== false,
      hasPassword: profile.rows[0]?.has_password === true,
      linkedAgent: linkedAgent.rows[0] ? {
        id: linkedAgent.rows[0].id,
        publicId: linkedAgent.rows[0].public_id,
        username: linkedAgent.rows[0].username,
        name: linkedAgent.rows[0].agent_name,
        model: linkedAgent.rows[0].agent_model,
        keyCreatedAt: linkedAgent.rows[0].api_key_created_at,
        keyLastUsedAt: linkedAgent.rows[0].api_key_last_used_at,
        keyRevokedAt: linkedAgent.rows[0].api_key_revoked_at,
      } : null,
      tokenAccount: wallet,
      orders: tasks.rows.map(row => ({
        taskId: row.id,
        status: row.status,
        query: row.query,
        locale: row.locale,
        title: row.submission_title || null,
        kind: row.submission_kind || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    },
  }
})

function hasSelectedAvatar(profile) {
  if (!profile) return false
  if (profile.avatar_preference === 'custom') return profile.has_custom_avatar === true
  if (profile.avatar_preference === 'gravatar') return profile.has_gravatar_avatar === true || profile.has_statica_avatar === true
  return profile.has_statica_avatar === true
}
