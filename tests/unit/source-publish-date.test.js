import { extractPublishedDate, resolveSourcePublishedAt } from '../../server/utils/source-publish-date.js'

export async function run({ assert }) {
  // extractPublishedDate: reads article:published_time / datePublished meta / <time>
  const withMeta = '<html><head><meta property="article:published_time" content="2023-05-14T09:30:00Z"></head></html>'
  assert(extractPublishedDate(withMeta) === '2023-05-14', 'reads article:published_time')

  const withName = '<html><head><meta name="datePublished" content="2021-01-02"></head></html>'
  assert(extractPublishedDate(withName) === '2021-01-02', 'reads datePublished')

  const withTime = '<html><body><time datetime="2022-08-09T12:00:00+02:00">09 Aug 2022</time></body></html>'
  assert(extractPublishedDate(withTime) === '2022-08-09', 'reads <time datetime>')

  // normalize single-digit month/day, reject garbage
  const loose = '<meta property="article:published_time" content="2024-2-3T00:00:00Z">'
  assert(extractPublishedDate(loose) === '2024-02-03', 'normalizes single-digit month/day')

  const garbage = '<meta property="article:published_time" content="not-a-date">'
  assert(extractPublishedDate(garbage) === null, 'rejects non-dates')

  assert(extractPublishedDate('<html>no date anywhere</html>') === null, 'rejects HTML without dates')

  // resolveSourcePublishedAt: prefers HTML date over provided fallback
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response('<html><head><meta property="article:published_time" content="2020-06-01T00:00:00Z"></head></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
    const fromHtml = await resolveSourcePublishedAt({ url: 'https://example.org/article', publishedAt: '2019-01-01' })
    assert(fromHtml === '2020-06-01', 'prefers HTML-extracted date')

    // fallback to recorded date when the fetch fails / returns no date
    globalThis.fetch = async () => { throw new Error('network down') }
    const fallback = await resolveSourcePublishedAt({ url: 'https://example.org/article', publishedAt: '2019-01-01' })
    assert(fallback === '2019-01-01', 'falls back to recorded source date when HTML cannot be read')

    // no URL -> recorded date only
    assert((await resolveSourcePublishedAt({ publishedAt: '2018-12-31' })) === '2018-12-31', 'recorded date used when URL absent')
  } finally {
    globalThis.fetch = originalFetch
  }
}
