export const ACCESS_TO_STATUS = { public: 'published', link: 'unlisted', author: 'hidden' }
export const STATUS_TO_ACCESS = { published: 'public', unlisted: 'link', hidden: 'author', pending: 'pending' }

const STAFF = new Set(['owner', 'admin', 'moderator'])

export function readableTopicSql(alias, actorPlaceholder) {
  return `(${alias}.status IN ('published', 'unlisted') OR (${alias}.status = 'hidden' AND ${alias}.author_id = ${actorPlaceholder}::uuid) OR (${alias}.status = 'pending' AND ${actorPlaceholder}::uuid IS NOT NULL AND (${alias}.author_id = ${actorPlaceholder}::uuid OR EXISTS (SELECT 1 FROM actors staff WHERE staff.id = ${actorPlaceholder}::uuid AND staff.role IN ('owner', 'admin', 'moderator')) OR EXISTS (SELECT 1 FROM branch_roles duty WHERE duty.branch_id = ${alias}.branch_id AND duty.actor_id = ${actorPlaceholder}::uuid AND duty.role IN ('leader', 'moderator')))))`
}

export function accessChoices(topic, actor) {
  if (!topic || !actor || topic.status === 'pending') return []
  if (actor.id === topic.author_id) return ['link', 'public', 'author']
  if (STAFF.has(actor.role) && (topic.status === 'published' || topic.status === 'unlisted')) return ['link', 'public']
  return []
}

export function presentAccess(topic, actor) {
  const choices = accessChoices(topic, actor)
  return {
    access: STATUS_TO_ACCESS[topic.status] || 'public',
    accessChoices: choices,
    canChangeAccess: choices.some(choice => ACCESS_TO_STATUS[choice] !== topic.status),
  }
}

export function nextTopicStatus(topic, actor, access) {
  const status = ACCESS_TO_STATUS[access]
  if (!status || !topic || topic.status === 'deleted') return null
  if (status === topic.status) return null
  if (!accessChoices(topic, actor).includes(access)) return null
  return status
}
