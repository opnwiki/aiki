import { createPatch, displayFromOps } from './revision-diff.js'

const ORIGINS = new Set(['publication', 'accepted_edit', 'author_edit', 'translation', 'import'])

export async function recordRevisionDiff(client, change) {
  const origin = String(change.origin || '')
  if (!ORIGINS.has(origin)) throw new Error('Unknown revision diff origin.')
  const parentTitle = change.parentTitle ?? ''
  const parentBody = change.parentBody ?? ''
  const titleOps = createPatch(parentTitle, change.title)
  const bodyOps = createPatch(parentBody, change.body)
  await client.query(
    `INSERT INTO revision_diffs (
       revision_id, parent_revision_id, proposal_id, origin,
       introduced_by_actor_id, confirmed_by_actor_id,
       introduced_at, confirmed_at, introduced_label, confirmed_label,
       title_ops, body_ops
     )
     VALUES (
       $1, $2, $3, $4, $5, $6,
       coalesce($7::timestamptz, now()), coalesce($8::timestamptz, now()),
       NULLIF($9::text, ''), NULLIF($10::text, ''),
       $11::jsonb, $12::jsonb
     )
     ON CONFLICT (revision_id) DO NOTHING`,
    [
      change.revisionId,
      change.parentRevisionId || null,
      change.proposalId || null,
      origin,
      change.introducedBy || null,
      change.confirmedBy || null,
      change.introducedAt || null,
      change.confirmedAt || null,
      cleanLabel(change.introducedLabel),
      cleanLabel(change.confirmedLabel),
      JSON.stringify(titleOps),
      JSON.stringify(bodyOps),
    ],
  )
}

export async function ensureTopicDiffs(database, topicId) {
  const missing = await database.query(
    `SELECT count(*)::int AS total
       FROM revisions revision
       LEFT JOIN revision_diffs diff ON diff.revision_id = revision.id
      WHERE revision.topic_id = $1 AND diff.revision_id IS NULL`,
    [topicId],
  )
  if (!missing.rows[0]?.total) return
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const rows = await client.query(
      `SELECT revision.id, revision.parent_revision_id, revision.title, revision.body_markdown,
              revision.author_id, revision.created_at, revision.source_revision_id, revision.model_name,
              parent.title AS parent_title, parent.body_markdown AS parent_body,
              proposal.id AS proposal_id, proposal.author_id AS proposer_id, proposal.created_at AS proposed_at,
              proposal.reviewed_by_actor_id, proposal.reviewed_at
         FROM revisions revision
         LEFT JOIN revisions parent ON parent.id = revision.parent_revision_id
         LEFT JOIN edit_proposals proposal ON proposal.result_revision_id = revision.id
         LEFT JOIN revision_diffs diff ON diff.revision_id = revision.id
        WHERE revision.topic_id = $1 AND diff.revision_id IS NULL
        ORDER BY revision.created_at ASC, revision.id ASC`,
      [topicId],
    )
    for (const row of rows.rows) {
      const accepted = Boolean(row.proposal_id)
      const translated = !accepted && row.source_revision_id
      await recordRevisionDiff(client, {
        revisionId: row.id,
        parentRevisionId: row.parent_revision_id,
        parentTitle: row.parent_title || '',
        parentBody: row.parent_body || '',
        title: row.title,
        body: row.body_markdown,
        origin: accepted ? 'accepted_edit' : translated ? 'translation' : 'publication',
        introducedBy: accepted ? row.proposer_id : translated ? null : row.author_id,
        confirmedBy: accepted ? row.reviewed_by_actor_id : translated ? null : row.author_id,
        introducedAt: accepted ? row.proposed_at : row.created_at,
        confirmedAt: accepted ? row.reviewed_at : row.created_at,
        proposalId: row.proposal_id,
        introducedLabel: translated ? row.model_name : null,
      })
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export function presentChange(row, { includeOps = false } = {}) {
  if (!row?.origin) return null
  const change = {
    id: row.id,
    origin: row.origin,
    proposalId: row.proposal_id || null,
    introducedAt: row.introduced_at,
    confirmedAt: row.confirmed_at,
    introducedBy: person(row.introduced_username, row.introduced_public_id, row.introduced_display_name, row.introduced_agent_name),
    confirmedBy: person(row.confirmed_username, row.confirmed_public_id, row.confirmed_display_name, row.confirmed_agent_name),
    introducedLabel: row.introduced_label || null,
    confirmedLabel: row.confirmed_label || null,
    title: displayFromOps(row.title_ops),
    body: displayFromOps(row.body_ops),
  }
  if (includeOps) {
    change.parentId = row.parent_revision_id || null
    change.titleText = row.title
    change.bodyText = row.body_markdown
    change.titleOps = row.title_ops || []
    change.bodyOps = row.body_ops || []
  }
  return change
}

export const REVISION_DIFF_JOIN = `
  LEFT JOIN revision_diffs diff ON diff.revision_id = revision.id
  LEFT JOIN actors introduced ON introduced.id = diff.introduced_by_actor_id
  LEFT JOIN actors confirmed ON confirmed.id = diff.confirmed_by_actor_id`

export const REVISION_DIFF_COLUMNS = `
  diff.origin, diff.proposal_id, diff.introduced_at, diff.confirmed_at,
  diff.introduced_label, diff.confirmed_label, diff.title_ops, diff.body_ops,
  introduced.username AS introduced_username, introduced.display_name AS introduced_display_name, introduced.agent_name AS introduced_agent_name, introduced.public_id AS introduced_public_id,
  confirmed.username AS confirmed_username, confirmed.display_name AS confirmed_display_name, confirmed.agent_name AS confirmed_agent_name, confirmed.public_id AS confirmed_public_id`

function person(username, publicId, displayName, agentName) {
  if (!username && (publicId === null || publicId === undefined)) return null
  return { username: username || null, displayName: displayName || agentName || null, publicId: publicId == null ? null : String(publicId) }
}

function cleanLabel(value) {
  const label = String(value ?? '').replace(/\0/g, '').trim().slice(0, 120)
  return label
}
