import { enforceSameOrigin } from '../../server/utils/auth.js'

function event({ method = 'POST', headers = {}, protocol = 'https', host = 'aiki.test', path = '/api/topics' } = {}) {
  return {
    method,
    path,
    node: {
      req: {
        method,
        originalUrl: path,
        headers: { host, ...headers },
        connection: { encrypted: protocol === 'https' },
      },
    },
  }
}

export function run({ assert }) {
  assert.throws(
    () => enforceSameOrigin(event()),
    (error) => error.statusCode === 403 && error.statusMessage === 'Request origin could not be verified',
    'unsafe requests without Origin and Fetch Metadata must fail closed',
  )

  assert.throws(
    () => enforceSameOrigin(event({ headers: { origin: 'https://attacker.test' } })),
    (error) => error.statusCode === 403 && error.statusMessage === 'Cross-origin request blocked',
  )
  assert.throws(
    () => enforceSameOrigin(event({ headers: { 'sec-fetch-site': 'cross-site' } })),
    (error) => error.statusCode === 403 && error.statusMessage === 'Cross-site request blocked',
  )
  assert.throws(
    () => enforceSameOrigin(event({ headers: { origin: 'null' } })),
    (error) => error.statusCode === 403 && error.statusMessage === 'Invalid request origin',
  )

  assert.throws(
    () => enforceSameOrigin(event({ headers: { 'sec-fetch-site': 'same-site' } })),
    (error) => error.statusCode === 403 && error.statusMessage === 'Request origin could not be verified',
    'same-site alone is insufficient because another subdomain may be untrusted',
  )
  assert.throws(
    () => enforceSameOrigin(event({ headers: { 'sec-fetch-site': 'none' } })),
    (error) => error.statusCode === 403 && error.statusMessage === 'Request origin could not be verified',
  )

  assert.doesNotThrow(() => enforceSameOrigin(event({ headers: { origin: 'https://aiki.test' } })))
  assert.doesNotThrow(() => enforceSameOrigin(event({ headers: { 'sec-fetch-site': 'same-origin' } })))
  assert.doesNotThrow(() => enforceSameOrigin(event({ headers: { origin: 'https://aiki.test', 'sec-fetch-site': 'same-site' } })))

  assert.doesNotThrow(() => enforceSameOrigin(event({ method: 'GET' })), 'safe methods do not require request metadata')
  assert.doesNotThrow(() => enforceSameOrigin(event({ method: 'OPTIONS' })), 'preflight is not a state-changing operation')
}
