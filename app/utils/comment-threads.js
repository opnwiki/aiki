export const COMMENT_SORTS = ['oldest', 'newest', 'top']

// Threads read like GitHub discussions: top-level comments in the chosen order,
// and every answer inside a comment in one flat list by time. An answer to an
// answer keeps `reply_to` so the list can say whom it answers.
export function buildCommentThreads(replies, { sort = 'oldest' } = {}) {
  const nodes = new Map()
  for (const reply of replies || []) {
    if (!reply?.id || nodes.has(reply.id)) continue
    const totals = voteTotals(reply)
    nodes.set(reply.id, { ...reply, ...totals, children: [], reply_to: null })
  }

  const roots = []
  const nested = new Map()
  for (const node of nodes.values()) {
    const parent = node.parent_reply_id ? nodes.get(node.parent_reply_id) : null
    if (!parent || createsCycle(node, parent, nodes)) roots.push(node)
    else nested.set(node.id, parent)
  }
  for (const [id, parent] of nested) {
    const node = nodes.get(id)
    let root = parent
    while (nested.has(root.id)) root = nested.get(root.id)
    if (parent !== root) node.reply_to = parent
    root.children.push(node)
  }
  roots.sort(rootOrder(COMMENT_SORTS.includes(sort) ? sort : 'oldest'))
  for (const root of roots) root.children.sort(byTime)
  return roots
}

export function hasDeepCommentThread(threads, minimumDepth = 2) {
  const depth = Number.isInteger(minimumDepth) && minimumDepth > 0 ? minimumDepth : 2
  function contains(items, currentDepth) {
    return (items || []).some((item) => currentDepth >= depth || contains(item?.children, currentDepth + 1))
  }
  return contains(threads, 0)
}

function voteTotals(reply) {
  const upvotes = Number(reply.upvotes) || 0
  const downvotes = Number(reply.downvotes) || 0
  const vote = reply.my_vote == null || reply.my_vote === '' ? null : Number(reply.my_vote)
  return {
    upvotes,
    downvotes,
    score: upvotes - downvotes,
    my_vote: vote === 1 || vote === -1 ? vote : null,
  }
}

function createsCycle(node, parent, nodes) {
  let current = parent
  const seen = new Set([node.id])
  while (current) {
    if (seen.has(current.id)) return true
    seen.add(current.id)
    current = current.parent_reply_id ? nodes.get(current.parent_reply_id) : null
  }
  return false
}

function byTime(a, b) {
  const time = String(a.created_at || '').localeCompare(String(b.created_at || ''))
  return time || String(a.id).localeCompare(String(b.id))
}

function rootOrder(sort) {
  if (sort === 'newest') return (a, b) => byTime(b, a)
  if (sort === 'top') return (a, b) => (b.score - a.score) || byTime(a, b)
  return byTime
}
