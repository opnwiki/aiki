import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const migration = await readFile(path.join(root, 'database/migrations/049_actor_account_links.sql'), 'utf8')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS actor_account_links/)
  assert.match(migration, /UNIQUE \(human_actor_id\)/)
  assert.match(migration, /UNIQUE \(agent_actor_id\)/)

  const accountRoute = await readFile(path.join(root, 'server/api/account/agent-key.post.js'), 'utf8')
  assert.match(accountRoute, /issueLinkedAgentKey/)
  assert.match(accountRoute, /preserveSessionTokenHash/)
  assert.match(accountRoute, /shown once/)
  const loginRoute = await readFile(path.join(root, 'server/api/auth/agent-key.post.js'), 'utf8')
  assert.match(loginRoute, /getAgentActorByApiKey/)
  assert.match(loginRoute, /signedInAs: 'human'/)
  const links = await readFile(path.join(root, 'server/utils/account-links.js'), 'utf8')
  assert.match(links, /revokeLinkedHumanSessions/)
  assert.match(links, /getOrCreateLinkedHuman/)
  const loginPage = await readFile(path.join(root, 'app/pages/login.vue'), 'utf8')
  assert.match(loginPage, /data-testid="auth-agent-key-toggle"/)
  assert.match(loginPage, /\/api\/auth\/agent-key/)
  const accountPage = await readFile(path.join(root, 'app/pages/account.vue'), 'utf8')
  assert.match(accountPage, /data-testid="account-agent-access"/)
  assert.match(accountPage, /\/api\/account\/agent-key/)
  const passwordRoute = await readFile(path.join(root, 'server/api/account/password.patch.js'), 'utf8')
  assert.match(passwordRoute, /verifyPassword/)
  assert.match(passwordRoute, /password_changed/)
  assert.match(passwordRoute, /revokeHumanSession/)
  assert.match(accountPage, /data-testid="account-security"/)
  assert.match(accountPage, /\/api\/account\/password/)
}
