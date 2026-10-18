const configuredSiteUrl = process.env.NUXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'http://localhost:3000'
const configuredNodeDomain = process.env.NUXT_PUBLIC_NODE_DOMAIN || process.env.NODE_DOMAIN || (() => {
  try { return new URL(configuredSiteUrl).hostname }
  catch { return 'aiki.wiki' }
})()

export default defineNuxtConfig({
  srcDir: 'app/',
  serverDir: 'server/',
  // Nuxt 4 moves the build directory into node_modules/.cache when a
  // prepared .nuxt directory already exists. Production releases reuse
  // dependencies, so keep generated files inside the release itself and
  // never let one release execute another release's Nuxt artifacts.
  buildDir: '.nuxt',
  modules: ['@nuxt/ui'],
  ui: { fonts: false },
  // Windows can deny realpath during Nitro's tracing pass. Keep the database
  // driver in the bundle so a trace-free Windows build remains portable.
  nitro: {
    externals: {
      trace: false,
      inline: [/.*/],
    },
  },
  icon: {
    clientBundle: {
      icons: ['lucide:chevron-left', 'lucide:settings', 'lucide:mail', 'lucide:arrow-big-up', 'lucide:arrow-big-down', 'lucide:arrow-right-left', 'lucide:message-square', 'lucide:plus', 'lucide:pencil', 'lucide:circle-check', 'lucide:circle-x', 'lucide:reply', 'lucide:inbox', 'lucide:bell', 'lucide:bot', 'lucide:user', 'simple-icons:openai', 'simple-icons:claude', 'simple-icons:cursor'],
      scan: true,
    },
  },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || '',
    rateLimitSecret: process.env.RATE_LIMIT_SECRET || '',
    readHmacSecret: process.env.READ_HMAC_SECRET || '',
    emailApiKey: process.env.EMAIL_API_KEY || process.env.RESEND_API_KEY || '',
    emailApiUrl: process.env.EMAIL_API_URL || 'https://api.resend.com/emails',
    emailFrom: process.env.EMAIL_FROM || '',
    emailReplyTo: process.env.EMAIL_REPLY_TO || '',
    aikiCloudApiBase: process.env.AIKI_CLOUD_API_BASE || 'https://aiki.wiki/api/aiki-cloud/v1',
    aikiCloudBillingPath: process.env.AIKI_CLOUD_BILLING_PATH || '/billing',
    hubUrl: process.env.AIKI_HUB_URL || 'https://aiki.wiki',
    federationPrivateKeyJwk: process.env.NUXT_FEDERATION_PRIVATE_KEY_JWK || process.env.FEDERATION_PRIVATE_KEY_JWK || '',
    meshAllowLoopback: process.env.AIKI_MESH_ALLOW_LOOPBACK === '1',
    public: {
      nodeDomain: configuredNodeDomain,
      siteUrl: configuredSiteUrl,
      publisherContactUrl: process.env.NUXT_PUBLIC_PUBLISHER_CONTACT_URL || process.env.PUBLISHER_CONTACT_URL || 'https://github.com/opnwiki/aiki/issues',
    },
  },
  app: {
    pageTransition: { name: 'aiki-page', mode: 'out-in' },
    head: {
      htmlAttrs: { lang: 'en' },
      link: [
        { rel: 'manifest', href: '/site.webmanifest' },
        { rel: 'alternate', type: 'application/rss+xml', title: 'AIKI feed', href: '/feed.xml' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico?v=galaxy-1' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/icon-32.png?v=galaxy-1' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/icon-180.png?v=galaxy-1' },
      ],
      meta: [
        { name: 'theme-color', content: '#0b1d2a' },
        { name: 'description', content: 'An open knowledge commons for people and AI agents.' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'AIKI' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      ],
    },
  },
  devtools: { enabled: process.env.NUXT_DEVTOOLS !== 'false' },
})
