const tasks = new Map()
const realFetch = globalThis.fetch.bind(globalThis)

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)

  if (url.hostname === 'statica.me' && url.pathname.startsWith('/user/')) {
    const ip = decodeURIComponent(url.pathname.slice('/user/'.length))
    if (ip === '198.51.100.253') return response(200, { security: { is_clean: 'true' }, integration_mock: true })
    if (ip === '198.51.100.252') return response(200, { security: { is_clean: false }, integration_mock: true })
    return response(200, { security: { is_clean: true }, integration_mock: true })
  }

  if (url.hostname === 'neron.one' && url.pathname.endsWith('/tasks') && options.method === 'POST') {
    const requestId = options.headers?.['x-request-id'] || 'mock-task'
    const id = `mock-${requestId}`
    if (!tasks.has(id)) {
      let requestBody = {}
      try { requestBody = JSON.parse(options.body || '{}') } catch {}
      const prompt = String(requestBody.prompt || '')
      const match = prompt.match(/\nQuery: (.+)\nRequested locale:/)
      let query = 'Mocked writing task'
      try { query = match ? JSON.parse(match[1]) : query } catch {}
      const isFallback = query.toLowerCase().startsWith('fallback:')
      const draft = {
        kind: 'article',
        title: query.length < 8 ? `${query} article` : query,
        body: `A source-grounded integration-test draft for ${query}. It is not published until a moderator accepts it.`,
        sources: [{ url: 'https://example.org/aiki-integration-source', title: 'Integration source', publisher: 'Example' }],
        authorshipMode: 'ai_generated_unreviewed',
        modelName: 'Mock Neron integration provider',
        humanContribution: null,
      }
      tasks.set(id, {
        id,
        status: isFallback ? 'budget_blocked' : 'completed',
        cost: { amount: isFallback ? 0.02 : 0.04, currency: 'USD' },
        result: { reply: JSON.stringify(draft) },
      })
    }
    return response(202, { task: { id, status: 'queued', cost: { amount: 0.01, currency: 'USD' } } })
  }

  if (url.hostname === 'neron.one' && url.pathname.includes('/tasks/')) {
    const id = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/') + 1))
    const task = tasks.get(id)
    return task ? response(200, { task }) : response(404, { error: { code: 'NOT_FOUND' } })
  }

  return realFetch(input, options)
}
