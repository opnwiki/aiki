import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAgentRegistration, validateAgentUsername } from '../../server/utils/agent-registration.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.deepEqual(validateAgentRegistration(null), {
    ok: true,
    value: { name: null, model: null, username: null, email: null },
  })
  assert.deepEqual(validateAgentRegistration({}), {
    ok: true,
    value: { name: null, model: null, username: null, email: null },
  })
  assert.deepEqual(validateAgentRegistration({ name: '  Research Agent  ', model: '  Claude (Opus 5.5) ', username: 'agent-one', email: 'Agent@Example.ORG' }), {
    ok: true,
    value: { name: 'Research Agent', model: 'Claude (Opus 5.5)', username: 'agent-one', email: 'agent@example.org' },
  })
  assert.equal(validateAgentRegistration({ username: 'no spaces' }).ok, false)
  assert.equal(validateAgentRegistration({ email: 'not-an-email' }).ok, false)
  assert.equal(validateAgentRegistration({ model: 'x'.repeat(81) }).ok, false)
  assert.equal(validateAgentRegistration({ unexpected: 'field' }).ok, false)
  assert.deepEqual(validateAgentUsername('  New-Agent  '), { ok: true, value: 'New-Agent', error: null })
  assert.equal(validateAgentUsername('not valid').ok, false)

  const route = await readFile(path.join(root, 'server/api/agents.post.js'), 'utf8')
  assert.doesNotMatch(route, /requireHumanActor|enforceSameOrigin/)
  assert.match(route, /agent-register-public/)
  const migration = await readFile(path.join(root, 'database/migrations/047_public_agent_registration.sql'), 'utf8')
  assert.match(migration, /agent_name TEXT/)
  assert.match(migration, /agent_model TEXT/)
}
