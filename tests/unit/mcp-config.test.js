import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MCP_INSTANCE, mcpClientConfigText, resolveMcpInstance } from '../../app/utils/mcp-config.js'
import { translate } from '../../app/utils/i18n.js'
import { isReservedSlug, normalizePageSlug } from '../../server/utils/validation.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.equal(DEFAULT_MCP_INSTANCE, 'https://aiki.wiki')
  assert.equal(resolveMcpInstance('').endpoint, 'https://aiki.wiki/mcp')
  assert.equal(resolveMcpInstance('   ').endpoint, 'https://aiki.wiki/mcp')
  assert.equal(resolveMcpInstance('https://aiki.wiki').endpoint, 'https://aiki.wiki/mcp')
  assert.equal(resolveMcpInstance('https://aiki.wiki/mcp').endpoint, 'https://aiki.wiki/mcp')
  assert.equal(resolveMcpInstance('https://node.example/wiki').endpoint, 'https://node.example/mcp')
  assert.equal(resolveMcpInstance('node.example').instance, 'https://node.example')
  assert.equal(resolveMcpInstance('http://127.0.0.1:3036').endpoint, 'http://127.0.0.1:3036/mcp')
  assert.equal(resolveMcpInstance('javascript:alert(1)'), null)
  assert.equal(resolveMcpInstance('https://user:secret@node.example'), null)
  assert.equal(resolveMcpInstance('not a url'), null)
  assert.equal(resolveMcpInstance('https://not%20a%20url'), null)

  const config = JSON.parse(mcpClientConfigText('https://other.example'))
  assert.equal(config.mcpServers.aiki.url, 'https://other.example/mcp')
  assert.equal(config.mcpServers.aiki.headers.Authorization, 'Bearer <agent-key>')
  assert.equal(JSON.parse(mcpClientConfigText('')).mcpServers.aiki.url, 'https://aiki.wiki/mcp')

  assert.equal(isReservedSlug('connect'), true)
  assert.equal(normalizePageSlug('connect'), null)
  assert.equal(translate('ru', 'mcp.intro').includes('aiki.wiki'), true)
  assert.equal(translate('en', 'mcp.instanceLabel'), 'Node address')
  assert.equal(translate('zh', 'mcp.title'), 'Connect an agent')

  const page = await readFile(path.join(root, 'app/pages/connect.vue'), 'utf8')
  for (const marker of ['data-testid="mcp-setup"', 'data-testid="mcp-instance"', 'data-testid="mcp-endpoint"', 'data-testid="mcp-config"', 'DEFAULT_MCP_INSTANCE']) {
    assert.ok(page.includes(marker), marker)
  }
  const home = await readFile(path.join(root, 'app/pages/index.vue'), 'utf8')
  const app = await readFile(path.join(root, 'app/app.vue'), 'utf8')
  assert.ok(home.includes("{ key: 'chatgpt'"), 'home offers ChatGPT MCP setup')
  assert.ok(home.includes("{ key: 'claude'"), 'home offers Claude MCP setup')
  assert.ok(home.includes("{ key: 'cursor'"), 'home offers Cursor MCP setup')
  assert.ok(home.includes("iconName: 'i-simple-icons-openai'"), 'home uses the OpenAI brand icon')
  assert.ok(home.includes("iconName: 'i-simple-icons-claude'"), 'home uses the Claude brand icon')
  assert.ok(home.includes("iconName: 'i-simple-icons-cursor'"), 'home uses the Cursor brand icon')
  assert.ok(!home.includes('href="/connect"'), 'home keeps technical MCP setup link out of the integration block')
  assert.ok(app.includes('href="/connect"'), 'footer links to MCP setup')
  const agent = await readFile(path.join(root, 'server/routes/agent.get.js'), 'utf8')
  assert.ok(agent.includes('https://aiki.wiki/mcp'), 'agent guide names the default MCP URL')
  assert.ok(agent.includes('https://aiki.wiki/connect'), 'agent guide points at the setup page')
}
