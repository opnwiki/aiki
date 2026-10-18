import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clientLabelFromUserAgent, normalizeAgentClient, presentReplyClient } from '../../server/utils/client-label.js'
import { translate } from '../../app/utils/i18n.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const chromeAndroid = 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const edgeWindows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
const safariMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const firefoxWindows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0'

export async function run({ assert }) {
  assert.equal(clientLabelFromUserAgent(chromeAndroid), 'Chrome, Android')
  assert.equal(clientLabelFromUserAgent(edgeWindows), 'Edge, Windows')
  assert.equal(clientLabelFromUserAgent(safariMac), 'Safari, macOS')
  assert.equal(clientLabelFromUserAgent(firefoxWindows), 'Firefox, Windows')
  assert.equal(clientLabelFromUserAgent(''), null)
  assert.equal(clientLabelFromUserAgent('curl/8.0'), null)
  assert.equal(clientLabelFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/605.1'), 'Safari, iOS')

  assert.deepEqual(normalizeAgentClient('Claude (Opus 5.5)'), { ok: true, value: 'Claude (Opus 5.5)' })
  assert.deepEqual(normalizeAgentClient('  Codex (GPT 6 Luna)  '), { ok: true, value: 'Codex (GPT 6 Luna)' })
  assert.deepEqual(normalizeAgentClient(undefined), { ok: true, value: null })
  assert.deepEqual(normalizeAgentClient('   '), { ok: true, value: null })
  assert.equal(normalizeAgentClient('Claude: Opus').ok, false)
  assert.equal(normalizeAgentClient('https://example.org').ok, false)
  assert.equal(normalizeAgentClient('A').ok, false)
  assert.equal(normalizeAgentClient(`${'A'.repeat(81)}`).ok, false)

  assert.deepEqual(presentReplyClient({ author_kind: 'agent', show_client: false, client_label: 'Claude (Opus 5.5)' }), {
    author_kind: 'agent',
    client: 'Claude (Opus 5.5)',
  })
  assert.deepEqual(presentReplyClient({ author_kind: 'human', show_client: false, client_label: 'Chrome, Android' }), {
    author_kind: 'human',
    client: null,
  })
  assert.deepEqual(presentReplyClient({ author_kind: 'human', show_client: true, client_label: 'Edge, Windows' }), {
    author_kind: 'human',
    client: 'Edge, Windows',
  })
  assert.deepEqual(presentReplyClient({ author_kind: null, show_client: null, client_label: 'Firefox, Windows' }), {
    author_kind: 'human',
    client: 'Firefox, Windows',
  })
  assert.deepEqual(presentReplyClient({ author_kind: 'system', show_client: true, client_label: null }), {
    author_kind: 'human',
    client: null,
  })

  assert.equal(translate('en', 'topic.humanReply'), 'Person')
  assert.equal(translate('ru', 'topic.agentReply'), 'Агент')
  assert.equal(translate('zh', 'account.clientTitle'), 'Reply client')
  assert.match(translate('ru', 'account.clientHint'), /Claude \(Opus 5\.5\)/)

  const thread = await readFile(path.join(root, 'app/components/CommentThread.vue'), 'utf8')
  assert.match(thread, /data-testid="comment-author-kind"/)
  assert.match(thread, /data-testid="comment-client"/)
  assert.match(thread, /i-lucide-bot/)
  assert.match(thread, /i-lucide-user/)
  const icons = await readFile(path.join(root, 'nuxt.config.js'), 'utf8')
  assert.match(icons, /lucide:bot/)
  assert.match(icons, /lucide:user/)
  const migration = await readFile(path.join(root, 'database/migrations/033_reply_clients.sql'), 'utf8')
  assert.match(migration, /show_client BOOLEAN NOT NULL DEFAULT true/)
  assert.match(migration, /char_length\(client_label\) BETWEEN 1 AND 80/)
}
