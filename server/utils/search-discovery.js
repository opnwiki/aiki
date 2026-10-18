import { notifyIndexNow } from './indexnow.js'
import { notifyWebSub } from './websub.js'

export async function notifySearchDiscovery({ siteUrl, paths = [] } = {}) {
  const [indexNow, webSub] = await Promise.all([
    notifyIndexNow({ siteUrl, paths }),
    notifyWebSub({ siteUrl }),
  ])
  return { indexNow, webSub }
}
