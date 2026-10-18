import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateApiUsernameCandidate, generateGamingUsernameCandidate, generateUsernameCandidate, validateUsername } from '../../server/utils/usernames.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  assert.equal(validateUsername('  curious-reader  ').value, 'curious-reader')
  assert.equal(validateUsername('curious-reader').ok, true)
  assert.equal(validateUsername('no spaces').ok, false)
  assert.match(generateUsernameCandidate(), /^[a-z]+-[a-z]+$/)
  assert.match(generateGamingUsernameCandidate(), /^[A-Z][a-z]+[A-Z][a-z]+$/)
  const gamingBase = generateGamingUsernameCandidate()
  assert.match(generateGamingUsernameCandidate({ includeNumbers: true, base: gamingBase }), /^[A-Z][a-z]+[A-Z][a-z]+\d{1,3}$/)

  const remoteCandidate = await generateApiUsernameCandidate(async (url, options) => {
    assert.equal(url, 'https://random-word-api.herokuapp.com/word?number=2&diff=2')
    assert.equal(options.redirect, 'error')
    return { ok: true, json: async () => ['silver', 'otter'] }
  })
  assert.equal(remoteCandidate, 'silver-otter')
  assert.equal(await generateApiUsernameCandidate(async () => ({ ok: false })), null)
  assert.equal(await generateApiUsernameCandidate(async () => ({ ok: true, json: async () => ['a', 'b'] })), null)

  const login = await readFile(path.join(root, 'app/pages/login.vue'), 'utf8')
  assert.match(login, /data-testid="auth-username-generate"/)
  assert.match(login, /i-lucide-dices/)
  assert.match(login, /username-availability/)
  assert.match(login, /usernameAvailability === true/)
  assert.match(login, /usernameAvailability === false/)

  const route = await readFile(path.join(root, 'server/api/auth/username-availability.get.js'), 'utf8')
  assert.match(route, /username-availability/)
  assert.match(route, /lower\(username\)/)
  assert.match(route, /generateGamingUsernameCandidate/)
  assert.match(route, /includeNumbers: true, base: username/)
  assert.match(route, /generateApiUsernameCandidate/)
}
