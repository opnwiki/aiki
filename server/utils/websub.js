import { DEFAULT_WEBSUB_HUB_URL, siteOrigin } from './sitemaps.js'

const WEBSUB_PUBLISH_ENDPOINT = 'https://pubsubhubbub.appspot.com/publish'

// WebSub is a public publish/subscribe protocol. This notification only tells
// the public hub that the RSS topic changed; it does not carry page content or
// any application credentials.
export async function notifyWebSub({ siteUrl } = {}) {
  const origin = siteOrigin(siteUrl)
  const feedUrl = `${origin}/feed.xml`
  try {
    const response = await fetch(WEBSUB_PUBLISH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: new URLSearchParams({ 'hub.mode': 'publish', 'hub.url': feedUrl }),
    })
    if (!response.ok) {
      console.warn(`[websub] publication returned ${response.status}`)
      return { submitted: false, status: response.status }
    }
    return { submitted: true, hub: DEFAULT_WEBSUB_HUB_URL, topic: feedUrl }
  } catch (error) {
    console.warn(`[websub] publication failed: ${error?.message || 'unknown error'}`)
    return { submitted: false, reason: 'network' }
  }
}
