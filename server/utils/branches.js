import { createError } from 'h3'
import { normalizeBranchSlug, validateBranch } from './validation.js'

const LEADER_JOIN = `
  LEFT JOIN LATERAL (
    SELECT actors.username
      FROM branch_roles role
      JOIN actors ON actors.id = role.actor_id
     WHERE role.branch_id = branches.id AND role.role = 'leader'
     ORDER BY role.created_at, actors.username
     LIMIT 1
  ) leader ON true`

export async function createBranch(client, { nodeId, actorId, title, description }) {
  const checked = validateBranch({ title, description })
  if (!checked.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Please correct the branch details.', data: { errors: checked.errors } })
  }
  const created = await client.query(
    `INSERT INTO branches (node_id, slug, title, description, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, slug, title, description, created_at`,
    [nodeId, checked.value.slug, checked.value.title, checked.value.description, actorId],
  )
  const branch = created.rows[0]
  await client.query(
    `INSERT INTO branch_roles (branch_id, actor_id, role) VALUES ($1, $2, 'leader')`,
    [branch.id, actorId],
  )
  await client.query(
    `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
     VALUES ($1::uuid, 'branch_created', 'branch', $2::text, jsonb_build_object('slug', $3::text))`,
    [actorId, branch.id, branch.slug],
  )
  return branch
}

export async function findBranchBySlug(client, slug) {
  const normalized = normalizeBranchSlug(slug)
  if (!normalized) return null
  const result = await client.query(
    `SELECT branches.id, branches.slug, branches.title, branches.description, branches.created_at,
            leader.username AS leader
       FROM branches
       ${LEADER_JOIN}
      WHERE branches.slug = $1
      LIMIT 1`,
    [normalized],
  )
  return result.rows[0] || null
}

export function branchConflict(error) {
  return error?.code === '23505' && String(error.constraint || '').includes('branch')
}
