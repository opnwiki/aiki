import { slugify } from './validation.js'

export const MAX_TOPIC_TAGS = 8
export const MAX_TAG_LENGTH = 48

export function normalizeTag(input) {
  const label = String(input || '')
    .normalize('NFKC')
    .replace(/^#+/, '')
    .replace(/\s+/gu, ' ')
    .replace(/\0/g, '')
    .trim()
  if (label.length > MAX_TAG_LENGTH) return null
  const slug = slugify(label).slice(0, MAX_TAG_LENGTH).replace(/-+$/g, '')
  return slug ? { slug, label } : null
}

export function validateTags(input) {
  if (input == null) return { ok: true, errors: {}, value: [] }
  if (!Array.isArray(input)) return { ok: false, errors: { tags: 'Tags must be a list of up to 8 names.' }, value: [] }
  if (input.length > MAX_TOPIC_TAGS) return { ok: false, errors: { tags: 'Use no more than 8 tags.' }, value: [] }

  const errors = {}
  const value = []
  const seen = new Set()
  input.forEach((item, index) => {
    if (typeof item !== 'string') {
      errors[`tags.${index}`] = 'Each tag must be a short text label.'
      return
    }
    const tag = normalizeTag(item)
    if (!tag) {
      errors[`tags.${index}`] = 'Each tag must contain letters or numbers.'
      return
    }
    if (!seen.has(tag.slug)) {
      seen.add(tag.slug)
      value.push(tag)
    }
  })
  return { ok: Object.keys(errors).length === 0, errors, value }
}

export async function attachTopicTags(client, { nodeId, topicId, tags = [] }) {
  const attached = []
  for (const [position, tag] of tags.entries()) {
    const created = await client.query(
      `INSERT INTO tags (node_id, slug, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (node_id, slug) DO UPDATE SET label = tags.label
       RETURNING id, slug, label`,
      [nodeId, tag.slug, tag.label],
    )
    const row = created.rows[0]
    await client.query(
      `INSERT INTO topic_tags (topic_id, tag_id, position)
       VALUES ($1, $2, $3)
       ON CONFLICT (topic_id, tag_id) DO UPDATE SET position = EXCLUDED.position`,
      [topicId, row.id, position],
    )
    attached.push({ slug: row.slug, label: row.label })
  }
  return attached
}
