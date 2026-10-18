import { readFile } from 'node:fs/promises'
import { createIntegrationToken, getIntegrationCredentialByToken, hashIntegrationToken, normalizeIntegrationCredential, safeIntegrationPublicUrl, allowedIntegrationMediaUrl } from '../../server/utils/integration-auth.js'
import { hashSecret } from '../../server/utils/auth.js'
import { inspectIntegrationAccountLink, issueIntegrationAccountLink, normalizeExternalIdentity, redeemIntegrationAccountLink, resolveExternalIdentity, revokeIntegrationSessionsAndLinks } from '../../server/utils/integration-identity.js'

const CREDENTIAL = {
  id: 'credential-one', node_id: 'home-node', connector: 'telegram-bot', provider: 'telegram',
  identity_providers: ['telegram', 'web'], scopes: ['imports:write', 'imports:read', 'account-links:write'], allowed_media_origins: ['https://media.example.org'],
}
const user = key => ({ provider: 'telegram', subjectType: 'user', subjectKey: key, username: 'same_name', displayName: 'Same Name' })

export async function run({ assert }) {
  const token = createIntegrationToken()
  assert.match(token, /^aiki_integration_[A-Za-z0-9_-]{43}$/)
  assert.notEqual(token, createIntegrationToken())
  assert.match(hashIntegrationToken(token), /^[a-f0-9]{64}$/)
  const authCalls = []
  const authDatabase = {
    revoked: false,
    async query(sql, values) {
      authCalls.push({ sql, values })
      if (this.revoked) return { rows: [] }
      return { rows: sql.startsWith('UPDATE') ? [{ id: CREDENTIAL.id }] : [{ ...CREDENTIAL, token_hash: hashIntegrationToken(token) }] }
    },
  }
  assert.equal(await getIntegrationCredentialByToken(authDatabase, token, { scope: 'imports:write', enabled: false }), null)
  assert.equal(authCalls.length, 0, 'disabled integrations must not authenticate even a valid key')
  assert.equal(await getIntegrationCredentialByToken(authDatabase, token, { scope: 'admin:write', enabled: true }), null)
  assert.equal(await getIntegrationCredentialByToken(authDatabase, 'aiki_agent_wrong', { scope: 'imports:write', enabled: true }), null)
  const authenticated = await getIntegrationCredentialByToken(authDatabase, token, { scope: 'imports:write', enabled: true })
  assert.equal(authenticated.node_id, CREDENTIAL.node_id)
  assert.equal(authenticated.token_hash, undefined)
  assert.equal(authCalls[0].values[0], hashIntegrationToken(token))
  assert.match(authCalls[0].sql, /revoked_at IS NULL AND \$2 = ANY\(scopes\)/)
  authDatabase.revoked = true
  assert.equal(await getIntegrationCredentialByToken(authDatabase, token, { scope: 'imports:write', enabled: true }), null)

  const settings = normalizeIntegrationCredential({ connector: 'telegram-bot', provider: 'telegram', label: 'Public bot', scopes: ['account-links:write'], allowedMediaOrigins: ['https://media.example.org'], identityProviders: ['telegram', 'web'] })
  assert.deepEqual(settings.identityProviders, ['telegram', 'web'])
  assert.throws(() => normalizeIntegrationCredential({ ...settings, scopes: ['admin:write'] }), /supported integration scopes/)
  assert.throws(() => normalizeIntegrationCredential({ ...settings, nodeId: 'different-node' }), /Invalid integration credential/)
  assert.throws(() => normalizeIntegrationCredential({ ...settings, allowedMediaOrigins: ['http://media.example.org'] }), /public HTTPS/)
  assert.throws(() => normalizeIntegrationCredential({ ...settings, identityProviders: ['web'] }), /primary provider/)
  assert.equal(safeIntegrationPublicUrl('http://news.example.org/story'), 'http://news.example.org/story')
  for (const value of ['http://127.0.0.1/', 'https://[::1]/', 'https://internal.local/', 'https://user:secret@example.org/', 'https://api.telegram.org/file/bot123%3Atoken/photo.jpg', 'https://example.org/photo?access_token=secret']) assert.equal(safeIntegrationPublicUrl(value), null, value)
  assert.equal(allowedIntegrationMediaUrl('https://media.example.org/avatar.webp', CREDENTIAL), 'https://media.example.org/avatar.webp')
  assert.equal(allowedIntegrationMediaUrl('http://media.example.org/avatar.webp', CREDENTIAL), null)
  assert.equal(allowedIntegrationMediaUrl('https://other.example.org/avatar.webp', CREDENTIAL), null)

  assert.throws(() => normalizeExternalIdentity({ ...user('42'), authorId: 'privileged-human' }, CREDENTIAL), /Invalid external identity/)
  assert.throws(() => normalizeExternalIdentity({ ...user('42'), provider: 'untrusted' }, CREDENTIAL), /permitted identity provider/)
  assert.throws(() => normalizeExternalIdentity({ provider: 'web', subjectType: 'user', subjectKey: '42' }, CREDENTIAL), /web publishers/)
  assert.throws(() => normalizeExternalIdentity({ ...user('42'), subjectType: 'channel' }, CREDENTIAL, { verifiedSender: true }), /Channel claims/)
  assert.equal(normalizeExternalIdentity({ provider: 'web', subjectType: 'publisher', subjectKey: 'http://news.example.org' }, CREDENTIAL).subjectKey, 'http://news.example.org')
  assert.throws(() => normalizeExternalIdentity({ provider: 'web', subjectType: 'publisher', subjectKey: 'http://news.example.org/path' }, CREDENTIAL), /canonical public/)

  const db = new IdentityDatabase()
  const original = await resolveExternalIdentity(db, CREDENTIAL, user('42'))
  assert.equal(original.actor.kind, 'external')
  assert.match(db.calls[0].sql, /pg_advisory_xact_lock_shared/, 'resolvers allow concurrent imports but must block account rebinding until commit')
  assert.equal(JSON.parse(db.calls[0].values[0])[0], 'integration-identity-mappings')
  const renamed = await resolveExternalIdentity(db, CREDENTIAL, { ...user('42'), username: 'renamed', displayName: 'Renamed Author' })
  assert.equal(renamed.actor.id, original.actor.id, 'renaming must keep identity and attribution stable')
  assert.equal(renamed.actor.username, original.actor.username, 'connector usernames must never become login credentials')
  assert.equal(renamed.identity.username, 'renamed')
  await resolveExternalIdentity(db, CREDENTIAL, { ...user('42'), avatarUrl: 'https://media.example.org/42.webp' })
  const noEnrichment = await resolveExternalIdentity(db, CREDENTIAL, { provider: 'telegram', subjectType: 'user', subjectKey: '42' })
  assert.equal(noEnrichment.identity.avatar_url, 'https://media.example.org/42.webp', 'temporary enrichment failure must preserve a known stable avatar')
  const namesake = await resolveExternalIdentity(db, CREDENTIAL, user('43'))
  assert.notEqual(namesake.actor.id, original.actor.id, 'equal display names must not merge identities')
  const channel = await resolveExternalIdentity(db, CREDENTIAL, { ...user('42'), subjectType: 'channel' })
  assert.notEqual(channel.actor.id, original.actor.id, 'user and channel keys have different namespaces')
  const promoted = await resolveExternalIdentity(db, CREDENTIAL, user('42'), { verifiedSender: true })
  assert.equal(promoted.actor.id, original.actor.id)
  assert.equal(promoted.actor.kind, 'human')
  assert.equal(promoted.actor.role, 'member')
  assert.equal(channel.actor.kind, 'external', 'verification must not confer channel ownership')
  db.actors.get(namesake.actor.id).account_status = 'suspended'
  await assert.rejects(() => resolveExternalIdentity(db, CREDENTIAL, user('43'), { verifiedSender: true }), /not active/)

  const login = await issueIntegrationAccountLink(db, CREDENTIAL, { purpose: 'login', identity: user('42') })
  assert.match(login.token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(db.links.size, 1)
  assert.equal(JSON.stringify(db.calls).includes(login.token), false, 'only a verifier may reach storage or audit logs')
  const inspected = await inspectIntegrationAccountLink(db, login.token)
  assert.equal(inspected.purpose, 'login')
  assert.equal(inspected.account.publicId, original.actor.public_id)
  assert.equal(db.sessions.length, 0, 'opening an account link must not sign a browser in')
  const signedIn = await redeemIntegrationAccountLink(db, login.token)
  assert.equal(signedIn.actor.id, original.actor.id)
  assert.match(signedIn.sessionToken, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(db.sessions[0].token_hash, hashSecret(signedIn.sessionToken))
  assert.equal(db.sessions[0].integration_credential_id, CREDENTIAL.id, 'a passwordless session must retain its integration issuer for revocation')
  await assert.rejects(() => redeemIntegrationAccountLink(db, login.token), /already been used/)

  const expires = await issueIntegrationAccountLink(db, CREDENTIAL, { purpose: 'login', identity: user('42') })
  db.links.get(hashSecret(expires.token)).expires_at = new Date(Date.now() - 1)
  await assert.rejects(() => redeemIntegrationAccountLink(db, expires.token), /expired/)
  const revoked = await issueIntegrationAccountLink(db, CREDENTIAL, { purpose: 'login', identity: user('42') })
  db.revoked = true
  await assert.rejects(() => redeemIntegrationAccountLink(db, revoked.token), /expired/)
  db.revoked = false

  const target = await resolveExternalIdentity(db, CREDENTIAL, user('99'), { verifiedSender: true })
  const linking = await issueIntegrationAccountLink(db, CREDENTIAL, { purpose: 'link', identity: user('42') })
  await assert.rejects(() => redeemIntegrationAccountLink(db, linking.token), /Sign in to your existing account/)
  assert.equal(db.links.get(hashSecret(linking.token)).consumed_at, null, 'missing browser proof must leave a link usable')
  const browserSessionHash = hashSecret('browser-session')
  db.sessions.push({ actor_id: target.actor.id, token_hash: browserSessionHash, revoked: true })
  await assert.rejects(() => redeemIntegrationAccountLink(db, linking.token, { human: target.actor, browserSessionHash }), /Sign in to your existing account/, 'a revoked browser session cannot confirm an identity link')
  db.sessions.at(-1).revoked = false
  const linkStart = db.calls.length
  const linked = await redeemIntegrationAccountLink(db, linking.token, { human: target.actor, browserSessionHash })
  const linkCalls = db.calls.slice(linkStart)
  const mappingLockIndex = linkCalls.findIndex(call => call.sql.includes('pg_advisory_xact_lock(') && JSON.parse(call.values[0])[0] === 'integration-identity-mappings')
  const actorLockIndex = linkCalls.findIndex(call => call.sql.includes('FROM actors WHERE id = ANY'))
  assert.ok(mappingLockIndex >= 0 && mappingLockIndex < actorLockIndex, 'rebinding must exclude imports before taking source or target actor locks')
  assert.equal(linkCalls.some(call => call.sql.includes('pg_advisory_xact_lock_shared')), false, 'a rebind needs the exclusive mapping lock')
  const lockedIdentityKeys = linkCalls.filter(call => call.sql.includes('pg_advisory_xact_lock(') && JSON.parse(call.values[0])[0] !== 'integration-identity-mappings').map(call => JSON.parse(call.values[0]).slice(1))
  assert.deepEqual(lockedIdentityKeys, [...lockedIdentityKeys].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), 'identity advisory locks use the same stable order as imports')
  assert.equal(linked.actor.id, target.actor.id)
  assert.equal(linked.sessionToken, null, 'linking must use the proven browser session')
  assert.equal(db.identities.get(original.identity.id).actor_id, target.actor.id)
  assert.equal(db.identities.get(original.identity.id).initial_actor_id, original.actor.id, 'historical attribution remains available')
  assert.equal(db.sessions[0].revoked, true, 'old bot account sessions must be revoked on rebinding')
  assert.equal(db.sessions.at(-1).integration_credential_id, undefined, 'an existing browser session must not acquire a new issuer through linking')
  await assert.rejects(() => redeemIntegrationAccountLink(db, linking.token, { human: target.actor, browserSessionHash }), /already been used/)

  const remaining = await issueIntegrationAccountLink(db, CREDENTIAL, { purpose: 'login', identity: user('99') })
  const issuedAgain = await redeemIntegrationAccountLink(db, remaining.token)
  const pendingAfter = await issueIntegrationAccountLink(db, CREDENTIAL, { purpose: 'login', identity: user('99') })
  assert.equal(db.sessions.at(-1).token_hash, hashSecret(issuedAgain.sessionToken))
  const ordinarySession = db.sessions.find(session => session.token_hash === browserSessionHash)
  await revokeIntegrationSessionsAndLinks(db, CREDENTIAL.id)
  assert.equal(db.sessions.at(-1).revoked, true, 'revoking the issuer must end previously issued sign-ins')
  assert.equal(ordinarySession.revoked, false, 'ordinary browser sessions must survive integration credential revocation')
  await assert.rejects(() => redeemIntegrationAccountLink(db, pendingAfter.token), /already been used/)

  const route = await readFile(new URL('../../server/api/auth/integration-link.post.js', import.meta.url), 'utf8')
  assert.match(route, /enforceSameOrigin\(event\)/)
  assert.match(route, /getHumanActor\(event\)/)
  assert.match(route, /COMMIT[\s\S]*setHumanSession/)
  const linkSource = await readFile(new URL('../../server/utils/integration-identity.js', import.meta.url), 'utf8')
  assert.match(linkSource, /links\.consumed_at IS NULL AND links\.expires_at > now\(\)/)
  assert.match(linkSource, /identities\.actor_id = links\.actor_id/)
  assert.match(linkSource, /FOR UPDATE OF links/)
  assert.match(linkSource, /ORDER BY id FOR UPDATE/)
  const page = await readFile(new URL('../../app/pages/integration-account.vue', import.meta.url), 'utf8')
  assert.match(page, /window\.location\.hash/)
  assert.match(page, /history\.replaceState/)
  assert.match(page, /@click="confirm"/)
  assert.doesNotMatch(page, /localStorage|sessionStorage/)
  const migration = await readFile(new URL('../../database/migrations/089_integration_identities.sql', import.meta.url), 'utf8')
  assert.match(migration, /UNIQUE \(node_id, provider, subject_type, subject_key\)/)
  assert.match(migration, /interval '5 minutes'/)
  assert.match(migration, /password_hash IS NULL AND api_key_hash IS NULL AND role = 'member'/)
  assert.match(migration, /integration_credential_id UUID REFERENCES integration_credentials\(id\) ON DELETE SET NULL/)
  const revokeRoute = await readFile(new URL('../../server/api/admin/integrations/[id].delete.js', import.meta.url), 'utf8')
  assert.match(revokeRoute, /BEGIN[\s\S]*UPDATE integration_credentials[\s\S]*revokeIntegrationSessionsAndLinks[\s\S]*COMMIT/)
}

class IdentityDatabase {
  constructor() { this.actors = new Map(); this.identities = new Map(); this.links = new Map(); this.sessions = []; this.calls = []; this.revoked = false }
  async query(sql, values = []) {
    this.calls.push({ sql, values })
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
    if (sql.includes('FROM integration_credentials WHERE id')) return { rows: this.revoked ? [] : [{ id: CREDENTIAL.id }] }
    if (sql.startsWith('SELECT * FROM external_identities')) return { rows: [...this.identities.values()].filter(row => row.node_id === values[0] && row.provider === values[1] && row.subject_type === values[2] && row.subject_key === values[3]) }
    if (sql.startsWith('SELECT id FROM external_identities')) return { rows: [{ id: values[0] }] }
    if (sql.startsWith('SELECT id, node_id, provider')) return { rows: [...this.identities.values()].filter(identity => identity.id === values[0] || (values[1] && identity.actor_id === values[1])) }
    if (sql.startsWith('INSERT INTO actors')) {
      const id = `actor-${this.actors.size + 1}`
      const actor = { id, public_id: String(10000000000000 + this.actors.size), node_id: values[0], kind: values[1], username: values[2], display_name: values[3], role: 'member', account_status: 'active' }
      this.actors.set(id, actor)
      return { rows: [actor] }
    }
    if (sql.startsWith('SELECT id FROM actors')) return { rows: values[0].map(id => this.actors.get(id)).filter(Boolean) }
    if (sql.startsWith('SELECT id FROM human_sessions')) return { rows: this.sessions.filter(session => session.actor_id === values[0] && session.token_hash === values[1] && !session.revoked) }
    if (sql.startsWith('SELECT id, public_id')) {
      const actor = this.actors.get(values[0])
      return { rows: actor && actor.node_id === values[1] && (!sql.includes("kind = 'human'") || (actor.kind === 'human' && actor.account_status === 'active')) ? [actor] : [] }
    }
    if (sql.startsWith('UPDATE actors')) {
      const actor = this.actors.get(values[0])
      if (sql.includes("kind = 'human'")) actor.kind = 'human'
      else actor.display_name = values[1]
      return { rows: [actor] }
    }
    if (sql.startsWith('INSERT INTO external_identities')) {
      const id = `identity-${this.identities.size + 1}`
      const identity = { id, node_id: values[0], provider: values[1], subject_type: values[2], subject_key: values[3], actor_id: values[4], initial_actor_id: values[4], username: values[5], display_name: values[6], profile_url: values[7], avatar_url: values[8], verified_at: values[9] ? new Date() : null }
      this.identities.set(id, identity)
      return { rows: [identity] }
    }
    if (sql.startsWith('UPDATE external_identities')) {
      const identity = this.identities.get(values[0])
      if (sql.includes('SET actor_id')) identity.actor_id = values[1]
      else Object.assign(identity, { username: values[1], display_name: values[2], profile_url: values[3], avatar_url: values[4], verified_at: values[5] ? new Date() : identity.verified_at })
      return { rows: [identity] }
    }
    if (sql.startsWith('INSERT INTO actor_audit_log')) return { rows: [] }
    if (sql.startsWith('INSERT INTO integration_account_links')) {
      const row = { id: `link-${this.links.size + 1}`, credential_id: values[0], identity_id: values[1], purpose: values[2], token_hash: values[3], actor_id: values[4], expires_at: new Date(Date.now() + 300_000), consumed_at: null }
      this.links.set(values[3], row)
      return { rows: [{ expires_at: row.expires_at }] }
    }
    if (sql.includes('FROM integration_account_links links')) {
      const link = this.links.get(values[0])
      const identity = this.identities.get(link?.identity_id)
      const actor = this.actors.get(identity?.actor_id)
      if (!link || link.consumed_at || link.expires_at < new Date() || this.revoked || link.actor_id !== identity?.actor_id || identity.subject_type !== 'user' || !identity.verified_at || actor?.kind !== 'human' || actor?.account_status !== 'active') return { rows: [] }
      return { rows: [{ ...link, ...actor, id: link.id, actor_id: link.actor_id, node_id: identity.node_id, provider: identity.provider, subject_type: identity.subject_type, current_actor_id: actor.id, external_display_name: identity.display_name, connector: CREDENTIAL.connector, credential_provider: CREDENTIAL.provider }] }
    }
    if (sql.startsWith('UPDATE integration_account_links')) {
      for (const row of this.links.values()) {
        const matches = sql.includes('WHERE credential_id =') ? row.credential_id === values[0] : sql.includes('WHERE id =') ? row.id === values[0] : row.identity_id === values[0]
        if (matches) { row.consumed_at = new Date(); row.consumed_by = values[1] }
      }
      return { rows: [] }
    }
    if (sql.startsWith('INSERT INTO human_sessions')) { this.sessions.push({ actor_id: values[0], token_hash: values[1], integration_credential_id: values[2], revoked: false }); return { rows: [] } }
    if (sql.startsWith('UPDATE human_sessions')) { for (const session of this.sessions) if (sql.includes('integration_credential_id =') ? session.integration_credential_id === values[0] : session.actor_id === values[0]) session.revoked = true; return { rows: [] } }
    throw new Error(`Unexpected unit database call: ${sql.slice(0, 100)}`)
  }
}
