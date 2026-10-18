<template>
  <UApp>
    <NuxtLoadingIndicator color="var(--aiki-accent)" :height="3" />
    <div class="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900">
      <header class="sticky top-0 z-30 shrink-0 border-b border-zinc-200/70 bg-white/80 backdrop-blur-xl">
        <div class="mx-auto flex w-full min-w-0 max-w-7xl items-center justify-between gap-3 px-3 py-3 sm:px-8">
          <NuxtLink to="/" class="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3" :aria-label="brandName">
            <img :src="shownIcon" alt="" width="44" height="40" class="h-10 w-11 shrink-0 object-contain" fetchpriority="high" @error="iconFailed = true">
            <img v-if="showWordmark" src="/aiki-wordmark.svg" alt="" width="64" height="40" data-testid="brand-wordmark" class="aiki-wordmark h-10 w-16 shrink-0" fetchpriority="high">
            <span v-else data-testid="brand-name" class="max-w-[7rem] truncate font-serif text-xl font-normal tracking-tight text-zinc-950 sm:max-w-[10rem] lg:max-w-[8rem] xl:max-w-[14rem]">{{ brandName }}</span>
          </NuxtLink>
          <button
            ref="menuButton"
            type="button"
            data-testid="nav-menu"
            class="relative grid size-11 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 lg:hidden"
            :aria-expanded="drawerOpen"
            aria-controls="site-menu"
            :aria-label="t('nav.openMenu')"
            @click="openDrawer"
          >
            <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            <span v-if="unreadCount" data-testid="notifications-badge" class="pointer-events-none absolute -top-1 -end-1 grid min-w-5 place-items-center rounded-full bg-[var(--aiki-accent)] px-1 text-[10px] font-semibold leading-5 text-[var(--aiki-accent-ink)]">{{ unreadLabel }}</span>
          </button>
          <nav class="hidden min-w-0 items-center justify-end gap-3 lg:flex xl:gap-5" aria-label="Main navigation">
            <NuxtLink v-for="item in navItems" :key="item.to" :to="item.to" class="text-sm font-medium text-zinc-600 hover:text-zinc-950">{{ item.label }}</NuxtLink>

            <button
              type="button"
              class="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              :aria-label="t(isDark ? 'nav.lightMode' : 'nav.darkMode')"
              :aria-pressed="isDark"
              :title="t(isDark ? 'nav.lightMode' : 'nav.darkMode')"
              @click="toggleTheme"
            >
              <svg v-if="isDark" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
              </svg>
              <svg v-else class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
              </svg>
            </button>

            <div ref="languagePicker" class="relative">
              <span :id="languageLabelId" class="sr-only">{{ t('nav.language') }}</span>
              <button
                ref="languageTrigger"
                type="button"
                class="inline-flex max-w-[104px] items-center gap-1 rounded-lg border border-zinc-200 bg-white px-1.5 py-2 text-sm text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 sm:max-w-[9rem] sm:gap-2 sm:px-2.5 xl:max-w-[150px]"
                role="combobox"
                aria-haspopup="listbox"
                :aria-labelledby="languageLabelId"
                :aria-expanded="menuOpen"
                :aria-controls="languageListId"
                @click="toggleMenu"
                @keydown.down.prevent="openAndFocusSelected"
                @keydown.enter.prevent="toggleMenu"
                @keydown.space.prevent="toggleMenu"
              >
                <img :src="flagUrl(language.flag)" :alt="''" width="24" height="16" class="h-4 w-6 shrink-0 rounded-sm object-cover" loading="lazy">
                <span class="truncate">{{ language.name }}</span>
                <svg class="ml-0.5 size-4 shrink-0 text-zinc-400 transition" :class="menuOpen ? 'rotate-180' : ''" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                </svg>
              </button>

              <div
                v-if="menuOpen"
                :id="languageListId"
                class="absolute right-0 z-50 mt-2 max-h-[min(24rem,70vh)] w-56 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl shadow-zinc-900/10"
                role="listbox"
                :aria-labelledby="languageLabelId"
                @keydown="handleMenuKeydown"
              >
                <button
                  v-for="(item, index) in languages"
                  :key="item.code"
                  ref="languageOptions"
                  type="button"
                  role="option"
                  :aria-selected="locale === item.code"
                  :tabindex="activeIndex === index ? 0 : -1"
                  class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition focus:bg-emerald-50 focus:outline-none"
                  :class="locale === item.code ? 'bg-emerald-50 font-semibold text-emerald-950' : 'text-zinc-700 hover:bg-zinc-50'"
                  @focus="activeIndex = index"
                  @click="chooseLanguage(item.code)"
                >
                  <img :src="flagUrl(item.flag)" :alt="''" width="24" height="16" class="h-4 w-6 shrink-0 rounded-sm object-cover" loading="lazy">
                  <span class="flex-1">{{ item.name }}</span>
                  <svg v-if="locale === item.code" class="size-4 text-emerald-700" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.313a1 1 0 0 1-1.42.003L3.29 9.31a1 1 0 0 1 1.42-1.406l4.04 4.082 6.54-6.59a1 1 0 0 1 1.414-.106Z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>

            <div v-if="actor" class="flex items-center gap-2">
              <NuxtLink to="/notifications" data-testid="nav-notifications" class="relative grid size-9 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" :aria-label="unreadCount ? t('nav.notificationsUnread', { count: formatCount(unreadCount) }) : t('nav.notifications')">
                <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
                  <path d="M10 20a2 2 0 0 0 4 0" />
                </svg>
                <span v-if="unreadCount" data-testid="notifications-badge" class="pointer-events-none absolute -top-1 -end-1 grid min-w-5 place-items-center rounded-full bg-[var(--aiki-accent)] px-1 text-[10px] font-semibold leading-5 text-[var(--aiki-accent-ink)]">{{ unreadLabel }}</span>
              </NuxtLink>
              <NuxtLink to="/account" class="block max-w-[8rem] truncate whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 xl:max-w-[16rem]" :title="actor.displayName || `${actor.username}@${nodeDomain}`" :aria-label="t('nav.account')">{{ actor.displayName || `${actor.username}@${nodeDomain}` }}</NuxtLink>
              <UButton type="button" color="neutral" variant="outline" size="sm" @click="signOut">{{ t('nav.signOut') }}</UButton>
            </div>
            <UButton v-else to="/login" color="neutral" variant="outline" size="sm">{{ t('nav.signIn') }}</UButton>
          </nav>
        </div>
      </header>
      <Transition name="drawer">
        <div v-if="drawerOpen" class="fixed inset-0 z-50 lg:hidden">
          <button type="button" class="absolute inset-0 bg-zinc-950/45" :aria-label="t('nav.closeMenu')" @click="closeDrawer(true)" />
          <aside
            id="site-menu"
            ref="drawerPanel"
            role="dialog"
            aria-modal="true"
            :aria-labelledby="drawerTitleId"
            data-testid="nav-drawer"
            class="absolute inset-y-0 end-0 flex w-[min(20rem,calc(100vw-2.75rem))] flex-col bg-white shadow-2xl"
            @keydown="onDrawerKeydown"
          >
            <div class="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <h2 :id="drawerTitleId" class="font-serif text-xl text-zinc-950">{{ t('nav.menu') }}</h2>
              <button
                type="button"
                data-drawer-close
                class="grid size-11 place-items-center rounded-xl border border-zinc-200 text-zinc-800 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                :aria-label="t('nav.closeMenu')"
                @click="closeDrawer(true)"
              >
                <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <nav class="flex flex-col gap-1 px-3 py-3" :aria-label="t('nav.menu')">
              <NuxtLink
                v-for="item in navItems"
                :key="`drawer-${item.to}`"
                :to="item.to"
                class="rounded-xl px-3 py-3 text-base font-medium"
                :class="route.path === item.to ? 'bg-emerald-50 font-semibold text-emerald-950' : 'text-zinc-800 hover:bg-zinc-50'"
                @click="closeDrawer(false)"
              >
                {{ item.label }}
              </NuxtLink>
            </nav>
            <div class="border-t border-zinc-200 px-3 py-3">
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                :aria-pressed="isDark"
                @click="toggleTheme"
              >
                <svg v-if="isDark" class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                </svg>
                <svg v-else class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                  <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
                </svg>
                {{ t(isDark ? 'nav.lightMode' : 'nav.darkMode') }}
              </button>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto border-t border-zinc-200 px-3 py-3">
              <p class="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('nav.language') }}</p>
              <div class="flex flex-col gap-1">
                <button
                  v-for="item in languages"
                  :key="item.code"
                  type="button"
                  class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm"
                  :class="locale === item.code ? 'bg-emerald-50 font-semibold text-emerald-950' : 'text-zinc-800 hover:bg-zinc-50'"
                  :aria-pressed="locale === item.code"
                  @click="setLocale(item.code)"
                >
                  <img :src="flagUrl(item.flag)" alt="" width="24" height="16" class="h-4 w-6 shrink-0 rounded-sm object-cover">
                  <span class="flex-1">{{ item.name }}</span>
                </button>
              </div>
            </div>
            <div class="border-t border-zinc-200 p-4">
              <template v-if="actor">
                <NuxtLink to="/notifications" data-testid="drawer-notifications" class="mb-2 flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50" @click="closeDrawer(false)">
                  <span>{{ t('nav.notifications') }}</span>
                  <span v-if="unreadCount" class="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--aiki-accent)] px-2 text-xs font-semibold text-[var(--aiki-accent-ink)]">{{ unreadLabel }}</span>
                </NuxtLink>
                <NuxtLink to="/account" class="block break-all rounded-xl px-3 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50" @click="closeDrawer(false)">
                  {{ actor.displayName || `${actor.username}@${nodeDomain}` }}
                </NuxtLink>
                <button type="button" class="mt-2 w-full rounded-xl border border-zinc-300 px-3 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50" @click="signOut">{{ t('nav.signOut') }}</button>
              </template>
              <NuxtLink v-else to="/login" class="aiki-button block rounded-xl px-3 py-3 text-center text-sm font-semibold" @click="closeDrawer(false)">{{ t('nav.signIn') }}</NuxtLink>
            </div>
          </aside>
        </div>
      </Transition>
      <main
        class="min-w-0 grow overflow-x-clip py-8 sm:py-12"
        :class="route.meta.fullBleed ? 'w-full' : 'mx-auto w-full max-w-7xl px-5 sm:px-8'"
      >
        <NuxtPage :transition="{ name: 'aiki-page', mode: 'out-in' }" />
      </main>
      <footer class="mt-16 shrink-0 border-t border-zinc-200 bg-white">
        <div class="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>{{ t('footer.tagline') }}</p>
          <details class="group relative">
            <summary class="inline-flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [&::-webkit-details-marker]:hidden">
              {{ t('footer.developerResources') }}
              <svg class="size-4 transition group-open:rotate-180" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
              </svg>
            </summary>
            <nav class="mt-2 flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg sm:absolute sm:bottom-full sm:right-0 sm:mt-0 sm:mb-2 sm:min-w-52" :aria-label="t('footer.developerResources')">
              <a href="/fediverse" class="rounded-lg px-3 py-2 text-zinc-700 hover:bg-emerald-50 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">{{ t('fedi.nav') }}</a>
              <a href="/connect" class="rounded-lg px-3 py-2 text-zinc-700 hover:bg-emerald-50 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">{{ t('mcp.nav') }}</a>
              <a href="/agent" class="rounded-lg px-3 py-2 text-zinc-700 hover:bg-emerald-50 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">{{ t('footer.agentGuide') }}</a>
              <a href="/api.txt" class="rounded-lg px-3 py-2 text-zinc-700 hover:bg-emerald-50 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">{{ t('footer.apiReference') }}</a>
              <a href="/openapi-v1.yaml" class="rounded-lg px-3 py-2 text-zinc-700 hover:bg-emerald-50 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">{{ t('footer.openapi') }}</a>
              <a href="/llms.txt" class="rounded-lg px-3 py-2 text-zinc-700 hover:bg-emerald-50 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">llms.txt</a>
            </nav>
          </details>
          <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <NuxtLink to="/terms" data-testid="footer-terms" class="font-medium text-zinc-700 hover:text-zinc-950">{{ t('footer.terms') }}</NuxtLink>
            <span aria-hidden="true">·</span>
            <a :href="repositoryUrl" data-testid="footer-source" class="font-medium text-zinc-700 hover:text-zinc-950" rel="noreferrer">{{ t('footer.source') }}</a>
            <span aria-hidden="true">·</span>
            <NuxtLink to="/node" class="font-medium text-zinc-700 hover:text-zinc-950">AIKI node</NuxtLink>
            <span aria-hidden="true"> · </span>
            <span>{{ nodeDomain }}</span>
            <span aria-hidden="true"> · </span>
            <span
              class="group relative inline-flex cursor-help items-center gap-1.5 rounded-md px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              data-testid="footer-online"
              tabindex="0"
              :aria-label="t('footer.online24hLabel', { count: online24h })"
            >
              <span class="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]" aria-hidden="true"></span>
              <span class="tabular-nums text-zinc-700">{{ online24h }}</span>
              <span role="tooltip" class="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-max max-w-[min(18rem,calc(100vw-2rem))] rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                {{ t('footer.serverVersion', { version: nodeVersion || '—' }) }}
              </span>
            </span>
          </p>
        </div>
      </footer>
    </div>
  </UApp>
</template>

<script setup>
import { accentDeclaration } from '~/utils/accent.js'
import { formatCount } from '~/utils/number-format.js'
import { sourceRepository } from '~/utils/source.js'

const { public: { nodeDomain, siteUrl } } = useRuntimeConfig()
const { data: nodePublic } = await useFetch('/api/node', { key: 'node-public' })
const brandName = computed(() => nodePublic.value?.node?.displayName || 'AiKi')
const online24h = computed(() => Number.isInteger(nodePublic.value?.node?.online24h) && nodePublic.value.node.online24h >= 0 ? nodePublic.value.node.online24h : 0)
const nodeVersion = computed(() => nodePublic.value?.node?.version || '')
const showWordmark = computed(() => brandName.value === 'AiKi')
const repositoryUrl = computed(() => nodePublic.value?.node?.repository || sourceRepository)
const brandIcon = computed(() => nodePublic.value?.node?.iconUrl || '/aiki-galaxy.webp')
const iconFailed = ref(false)
const shownIcon = computed(() => iconFailed.value ? '/aiki-galaxy.webp' : brandIcon.value)
watch(brandIcon, () => { iconFailed.value = false })
const faviconUrl = computed(() => nodePublic.value?.node?.faviconUrl || '')
useHead(() => faviconUrl.value ? {
  link: [
    { key: 'node-favicon', rel: 'icon', href: faviconUrl.value, tagPriority: 'critical' },
    { key: 'node-apple-touch', rel: 'apple-touch-icon', href: faviconUrl.value, tagPriority: 'critical' },
    { key: 'node-manifest', rel: 'manifest', href: `/api/webmanifest?v=${encodeURIComponent(faviconUrl.value)}`, tagPriority: 'critical' },
  ],
} : {})
const { data: authState, refresh: refreshAuthState } = await useFetch('/api/auth/me')
const { data: unreadState } = await useFetch('/api/notifications/unread', { key: 'notifications-unread' })
const unreadCount = computed(() => {
  const value = Number(unreadState.value?.unread || 0)
  return Number.isFinite(value) && value > 0 ? value : 0
})
const unreadLabel = computed(() => unreadCount.value > 99 ? '99+' : formatCount(unreadCount.value))
const actor = useState('auth-actor', () => authState.value?.actor || null)
watch(() => authState.value?.actor || null, value => {
  actor.value = value
})
const route = useRoute()
const { locale, language, languages, t, setLocale } = useLocale()
const canReviewReports = computed(() => ['owner', 'admin', 'moderator'].includes(actor.value?.role))
const navItems = computed(() => [
  { to: '/', label: t('nav.explore') },
  { to: '/topics', label: t('nav.topics') },
  { to: '/branches', label: t('nav.branches') },
  { to: '/tasks', label: t('nav.tasks') },
  ...(canReviewReports.value ? [{ to: '/reports', label: t('reports.nav') }] : []),
])
const drawerOpen = ref(false)
const drawerPanel = ref(null)
const menuButton = ref(null)
const drawerTitleId = 'site-menu-title'
const theme = useCookie('aiki-theme', { default: () => 'light', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
const isDark = computed(() => theme.value === 'dark')
useHead({
  htmlAttrs: {
    'data-theme': theme,
    class: computed(() => isDark.value ? 'dark' : undefined),
    style: computed(() => accentDeclaration({
      light: nodePublic.value?.node?.accentLight,
      dark: nodePublic.value?.node?.accentDark,
    })),
  },
})
const languagePicker = ref(null)
const languageTrigger = ref(null)
const languageOptions = ref([])
const menuOpen = ref(false)
const activeIndex = ref(0)
const languageLabelId = 'language-picker-label'
const languageListId = 'language-picker-listbox'

watch(locale, (value) => {
  useHead({ htmlAttrs: { lang: value, dir: value === 'ar' ? 'rtl' : 'ltr' } })
}, { immediate: true })

const structuredOrigin = computed(() => {
  try {
    return new URL(String(siteUrl || 'http://localhost:3000')).origin
  } catch {
    return 'http://localhost:3000'
  }
})
const socialImageUrl = computed(() => `${structuredOrigin.value}/icon-512.png`)
useHead(() => ({
  meta: [
    { property: 'og:image', content: socialImageUrl.value },
    { property: 'og:image:alt', content: `${brandName.value} mark` },
    { name: 'twitter:image', content: socialImageUrl.value },
    { name: 'twitter:image:alt', content: `${brandName.value} mark` },
  ],
}))
const structuredPageUrl = computed(() => {
  try {
    return new URL(route.path || '/', structuredOrigin.value).toString()
  } catch {
    return structuredOrigin.value
  }
})
const structuredPageType = computed(() => {
  if (route.path === '/node') return 'AboutPage'
  if (['/topics', '/branches', '/tasks'].includes(route.path)) return 'CollectionPage'
  return 'WebPage'
})
const structuredPageName = computed(() => {
  if (route.path === '/') return brandName.value
  if (route.path === '/topics') return t('topics.title')
  if (route.path === '/branches') return t('branches.title')
  if (route.path === '/tasks') return t('tasks.title')
  if (route.path === '/node') return t('node.title')
  if (route.path === '/terms') return t('terms.title')
  if (route.path === '/connect') return t('mcp.title')
  if (route.path === '/fediverse') return t('fedi.title', { brand: brandName.value })
  return brandName.value
})
const structuredPageDescription = computed(() => {
  if (route.path === '/') return t('home.description')
  if (route.path === '/topics') return t('topics.description')
  if (route.path === '/branches') return t('branches.description')
  if (route.path === '/tasks') return t('tasks.description')
  if (route.path === '/node') return t('node.intro')
  if (route.path === '/terms') return t('terms.intro', { domain: nodeDomain })
  if (route.path === '/connect') return t('mcp.intro')
  if (route.path === '/fediverse') return t('fedi.intro', { brand: brandName.value })
  return ''
})
const structuredData = computed(() => {
  const organizationId = `${structuredOrigin.value}/#organization`
  const websiteId = `${structuredOrigin.value}/#website`
  const webpageId = `${structuredPageUrl.value}#webpage`
  const contactUrl = nodePublic.value?.node?.contactUrl || undefined
  const iconUrl = nodePublic.value?.node?.iconUrl || '/icon-512.png'
  const absoluteIconUrl = (() => {
    try {
      return new URL(iconUrl, structuredOrigin.value).toString()
    } catch {
      return `${structuredOrigin.value}/icon-512.png`
    }
  })()
  const graph = [
    {
      '@type': 'Organization',
      '@id': organizationId,
      name: brandName.value,
      url: structuredOrigin.value,
      logo: { '@type': 'ImageObject', url: absoluteIconUrl },
      sameAs: [repositoryUrl.value],
      ...(contactUrl ? { contactPoint: { '@type': 'ContactPoint', url: contactUrl } } : {}),
    },
    {
      '@type': 'WebSite',
      '@id': websiteId,
      url: structuredOrigin.value,
      name: brandName.value,
      publisher: { '@id': organizationId },
      potentialAction: {
        '@type': 'SearchAction',
        target: `${structuredOrigin.value}/topics?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': structuredPageType.value,
      '@id': webpageId,
      url: structuredPageUrl.value,
      name: structuredPageName.value,
      ...(structuredPageDescription.value ? { description: structuredPageDescription.value } : {}),
      inLanguage: locale.value,
      isPartOf: { '@id': websiteId },
      publisher: { '@id': organizationId },
      ...(route.path === '/' ? { mainEntity: { '@id': websiteId } } : {}),
    },
  ]
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')
})
useHead(() => ({
  script: [{ key: 'site-jsonld', type: 'application/ld+json', children: structuredData.value }],
}))

watch(menuOpen, async (isOpen) => {
  if (!isOpen) return
  activeIndex.value = Math.max(0, languages.findIndex(item => item.code === locale.value))
  await nextTick()
  languageOptions.value[activeIndex.value]?.focus()
})

function flagUrl(countryCode) {
  return `https://flagcdn.com/w160/${countryCode}.png`
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function toggleTheme() {
  theme.value = isDark.value ? 'light' : 'dark'
}

function openDrawer() {
  drawerOpen.value = true
}

function closeDrawer(returnFocus = false) {
  drawerOpen.value = false
  if (returnFocus) nextTick(() => menuButton.value?.focus())
}

function onDrawerKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDrawer(true)
    return
  }
  if (event.key !== 'Tab' || !drawerPanel.value) return
  const items = [...drawerPanel.value.querySelectorAll('a, button')].filter(element => !element.disabled)
  const first = items[0]
  const last = items.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(drawerOpen, async (isOpen) => {
  if (import.meta.client) document.body.style.overflow = isOpen ? 'hidden' : ''
  if (!isOpen) return
  await nextTick()
  drawerPanel.value?.querySelector('[data-drawer-close]')?.focus()
})

watch(() => route.fullPath, () => {
  if (drawerOpen.value) closeDrawer(false)
})

function openAndFocusSelected() {
  if (!menuOpen.value) menuOpen.value = true
  else focusOption(activeIndex.value + 1)
}

function focusOption(index) {
  const lastIndex = languages.length - 1
  activeIndex.value = (index + languages.length) % languages.length
  nextTick(() => languageOptions.value[activeIndex.value]?.focus())
}

function handleMenuKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    focusOption(activeIndex.value + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    focusOption(activeIndex.value - 1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    focusOption(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    focusOption(languages.length - 1)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
  }
}

function chooseLanguage(code) {
  setLocale(code)
  closeMenu(true)
}

function closeMenu(returnFocus = false) {
  menuOpen.value = false
  if (returnFocus) nextTick(() => languageTrigger.value?.focus())
}

function handleOutsidePointer(event) {
  if (menuOpen.value && !languagePicker.value?.contains(event.target)) closeMenu()
}

onMounted(() => document.addEventListener('pointerdown', handleOutsidePointer))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsidePointer)
  document.body.style.overflow = ''
})

async function signOut() {
  closeDrawer(false)
  await $fetch('/api/auth/logout', { method: 'POST' })
  await refreshAuthState()
  await navigateTo('/')
}
</script>
