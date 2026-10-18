// Opening a page from deep in a feed kept the old scroll position, so the new
// page showed only a blank stretch until the reader scrolled up.
export default {
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash, top: 80 }
    if (to.path !== from.path) return { top: 0 }
  },
}
