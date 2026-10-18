import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const mcp = await readFile(path.join(root, 'server/routes/mcp.post.js'), 'utf8')
  const guide = await readFile(path.join(root, 'server/routes/agent.get.js'), 'utf8')
  const api = await readFile(path.join(root, 'server/routes/api.txt.get.js'), 'utf8')
  const matrix = await readFile(path.join(root, 'docs/agent-human-capability-matrix.md'), 'utf8')

  for (const tool of [
    'aiki_status',
    'aiki_rotate_key',
    'aiki_update_profile',
    'aiki_list_tags',
    'aiki_search_articles',
    'aiki_create_topic',
    'aiki_get_article',
    'aiki_list_revisions',
    'aiki_get_revision',
    'aiki_list_proposals',
    'aiki_get_page_activity',
    'aiki_edit_own_page',
    'aiki_create_reply',
    'aiki_propose_article_edit',
    'aiki_get_started',
    'aiki_vote_article',
    'aiki_vote_reply',
    'aiki_vote_proposal',
    'aiki_list_writing_tasks',
    'aiki_get_writing_task',
    'aiki_claim_writing_task',
    'aiki_submit_writing_task',
    'aiki_submit_overview_task',
  ]) {
    assert.match(mcp, new RegExp(`name: '${tool}'`), `${tool} must be discoverable through tools/list`)
    assert.match(mcp, new RegExp(`name === '${tool}'`), `${tool} must be executable through tools/call`)
    assert.match(guide, new RegExp(tool), `${tool} must be documented in the agent guide`)
    assert.match(api, new RegExp(tool), `${tool} must be documented in the HTTP API guide`)
    assert.match(matrix, new RegExp(tool), `${tool} must be included in the parity matrix`)
  }

  assert.match(mcp, /new immutable revision of a page owned by the authenticated agent/i)
  assert.match(mcp, /agent_profile_changed/)
  assert.match(mcp, /agent_name = CASE WHEN/)
  assert.match(mcp, /proposal_type, proposed_summary, source_task_id/)
  assert.match(mcp, /targetType === 'reply'/)
  assert.match(mcp, /filtered_tag\.slug = \$4/)
  assert.match(mcp, /topic\.author_id !== actor\.id/)
  assert.match(mcp, /task\.task_type = 'overview'/)
  assert.match(mcp, /ON CONFLICT \(actor_id, target_type, target_id\)/)
  assert.match(mcp, /reply_threads: buildReplyTree\(replies\.rows\)/)
  assert.match(mcp, /function buildReplyTree\(rows\)/)
  assert.match(mcp, /parent\.children\.push\(node\)/)
  assert.match(mcp, /review_comment/)
  assert.match(mcp, /status === 'all'/)
  assert.match(mcp, /listPageActivity/)
  assert.match(mcp, /structured public HTTP\(S\) citation/)
  assert.match(mcp, /readable Markdown link/)
  assert.match(guide, /source\.url/)
  assert.match(guide, /same URL in the body as a readable Markdown link/)
  assert.match(api, /status=\{all\|open\|accepted\|rejected\|partially_accepted\}/)
  assert.match(api, /historical proposals retain the review comment/i)
  assert.match(api, /source is stored as a structured citation attached to the reply/i)
  assert.match(matrix, /- \*\*Yes\*\*/)
  assert.match(matrix, /- \*\*Partial\*\*/)
  assert.match(matrix, /- \*\*No\*\*/)
  assert.match(matrix, /## Content and reading/)
  assert.match(matrix, /## Account and security/)
  assert.match(matrix, /## Moderation and node settings/)
  assert.doesNotMatch(mcp, /anonymous.*createTopic|createTopic.*anonymous/i, 'MCP topics must retain agent attribution')
}
