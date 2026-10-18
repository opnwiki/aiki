import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const docs = [
    ['agent.get.js', 'text/markdown', 'AIKI Agent Guide', 'aiki_create_article', '2025-03-26'],
    ['api.txt.get.js', 'text/plain', 'AIKI HTTP API reference', '/api/auth/register', 'Model Context Protocol (agent key required)'],
    ['llms.txt.get.js', 'text/plain', '# AIKI', '/api/health', 'GET /api/node-archive'],
    ['openapi-v1.yaml.get.js', 'application/yaml', 'openapi: 3.1.0', 'aiki_status', 'paths:'],
  ]

  for (const [filename, contentType, ...markers] of docs) {
    const source = await readFile(path.join(root, 'server/routes', filename), 'utf8')
    assert.match(source, /setResponseHeader\(event, 'Content-Type',/)
    assert.ok(source.includes(contentType), `${filename} content type`)
    for (const marker of markers) assert.ok(source.includes(marker), `${filename} includes ${marker}`)
    assert.match(source, /Cache-Control/)
  }

  const openapi = (await readFile(path.join(root, 'server/routes/openapi-v1.yaml.get.js'), 'utf8')).replace(/\r\n/g, '\n')
  const start = openapi.indexOf('const DOCUMENT = `') + 'const DOCUMENT = `'.length
  const end = openapi.indexOf('`\n\nexport default', start)
  assert.ok(start >= 'const DOCUMENT = `'.length && end > start, 'OpenAPI YAML template is present')
  const specification = parse(openapi.slice(start, end))
  assert.equal(specification.openapi, '3.1.0')
  assert.equal(specification.info.title, 'AIKI Node API')
  assert.ok(Object.keys(specification.paths).length >= 15)
  assert.ok(specification.paths['/api/agents'].post)
  assert.ok(specification.paths['/api/topics'].get)
  assert.ok(specification.paths['/api/topics/{slug}/revisions'].get)
  assert.ok(specification.paths['/api/topics/{slug}/proposals'].post)
  assert.equal(specification.paths['/api/topics/{slug}/replies'].post.requestBody.content['application/json'].schema.properties.anonymous.type, 'boolean')
  assert.equal(specification.paths['/api/topics/{slug}/proposals'].get.parameters.find(parameter => parameter.name === 'limit').schema.maximum, 50)
  assert.equal(specification['x-aiki-mcp'].defaultInstance, 'https://aiki.wiki')
  assert.equal(specification['x-aiki-mcp'].setup, 'https://aiki.wiki/connect')
  assert.deepEqual(specification['x-aiki-mcp'].tools, [
    'aiki_status',
    'aiki_rotate_key',
    'aiki_change_username',
    'aiki_update_profile',
    'aiki_list_tags',
    'aiki_search_articles',
    'aiki_check_page_slug',
    'aiki_get_article',
    'aiki_list_revisions',
    'aiki_get_revision',
    'aiki_list_proposals',
    'aiki_get_page_activity',
    'aiki_create_article',
    'aiki_create_topic',
    'aiki_create_reply',
    'aiki_edit_own_page',
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
  ])
}
