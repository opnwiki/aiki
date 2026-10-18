<template>
  <div class="space-y-16 sm:space-y-20">
    <section class="relative rounded-[2rem] border border-zinc-200/80 bg-white px-6 py-10 shadow-sm sm:px-12 sm:py-16">
      <div class="pointer-events-none absolute inset-0 overflow-hidden rounded-[2rem]" aria-hidden="true">
        <div class="absolute -right-20 -top-24 size-80 rounded-full bg-emerald-100/70 blur-3xl"></div>
      </div>
      <div class="relative mx-auto max-w-3xl text-center">
        <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">{{ t('home.eyebrow') }}</p>
        <h1 class="mx-auto mt-5 max-w-3xl font-serif text-4xl font-normal leading-[1.08] tracking-tight text-zinc-950 sm:text-6xl">{{ t('home.title') }}</h1>
        <p class="mx-auto mt-5 max-w-2xl text-base leading-7 text-zinc-600 sm:text-lg">{{ t('home.description') }}</p>

        <div ref="searchRoot" class="relative z-20 mx-auto mt-8 max-w-2xl text-left">
          <form
            :class="composerMode ? 'block' : 'flex flex-col gap-3 sm:flex-row'"
            role="search"
            data-testid="home-search-form"
            :data-composer="composerMode ? 'true' : 'false'"
            @submit.prevent="composerMode ? orderArticle() : submitSearch()"
          >
            <label class="sr-only" for="topic-search">{{ t('home.searchPlaceholder') }}</label>
            <div
              class="min-w-0 flex-1 border bg-white transition-[border-radius,box-shadow] focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-100 dark:bg-zinc-900"
              :class="composerMode ? 'rounded-2xl border-zinc-300 p-3 shadow-lg shadow-zinc-950/5 sm:p-4' : 'rounded-xl border-zinc-200'"
            >
              <textarea
                id="topic-search"
                ref="searchInput"
                v-model="search"
                rows="1"
                :maxlength="MAX_COMPOSER_LENGTH"
                autocomplete="off"
                aria-autocomplete="list"
                aria-controls="home-search-results"
                :aria-expanded="String(searchOpen && Boolean(search.trim()))"
                :placeholder="t('home.searchPlaceholder')"
                class="block w-full resize-none bg-transparent text-base leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
                :class="composerMode ? 'max-h-[50vh] overflow-y-auto px-1 py-1' : 'overflow-hidden px-4 py-3.5'"
                @input="resizeSearchInput"
                @focus="searchOpen = true"
                @keydown="onSearchKeydown"
              />
              <div v-if="composerMode" class="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <span class="text-xs leading-5 text-zinc-500">{{ t('home.composerHint') }}</span>
                <UButton
                  type="submit"
                  color="primary"
                  size="lg"
                  class="ms-auto justify-center px-5"
                  icon="i-lucide-sparkles"
                  :loading="orderPending"
                  :disabled="orderPending || !search.trim()"
                  data-testid="composer-create-page"
                >
                  {{ t('home.composerCreate') }}
                </UButton>
              </div>
            </div>
            <UButton v-if="!composerMode" type="submit" color="neutral" size="lg" class="aiki-button justify-center px-6" :data-testid="searchHasNoResults ? 'search-create-intent' : 'home-search-submit'">{{ searchActionLabel }}</UButton>
          </form>
          <p v-if="composerMode && orderMessage" class="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{{ orderMessage }}</p>

          <div
            v-if="searchOpen && search.trim() && !composerMode"
            id="home-search-results"
            class="absolute inset-x-0 top-full mt-2 max-h-[min(70vh,36rem)] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/15 dark:border-zinc-700 dark:bg-zinc-900"
            role="region"
            :aria-label="t('home.searchResults')"
            data-testid="search-dropdown"
          >
            <div v-if="search !== debouncedSearch || pending" class="p-5 text-sm text-zinc-500" role="status" aria-live="polite">{{ t('topics.loading') }}</div>
            <div v-else-if="error" class="p-5 text-sm text-amber-900" role="alert">{{ t('topics.unavailable') }}</div>
            <div v-else-if="!topics.length" class="p-5 text-sm text-zinc-600">{{ t('home.noMatch') }}</div>
            <ul v-else class="divide-y divide-zinc-100">
              <li v-for="item in topics" :key="`${item.result_type || 'topic'}:${item.id}`">
                <NuxtLink
                  v-if="item.result_type === 'task'"
                  :to="`/a/${encodeURIComponent(item.id)}`"
                  class="block px-5 py-4 outline-none transition hover:bg-amber-50 focus-visible:bg-amber-50 dark:hover:bg-amber-900/30 dark:focus-visible:bg-amber-900/30"
                  @click="searchOpen = false"
                >
                  <span class="flex flex-wrap items-center gap-2">
                    <span class="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900" data-testid="result-kind">{{ t('home.taskResult') }} · {{ taskStatusLabel(item.task_status) }}</span>
                    <span class="font-serif text-lg text-zinc-900">{{ item.title }}</span>
                  </span>
                  <span v-if="resultExcerpt(item)" data-testid="result-excerpt" class="mt-1.5 line-clamp-2 text-sm leading-5 text-zinc-600">{{ resultExcerpt(item) }}</span>
                  <span class="mt-2 block text-xs text-zinc-400">{{ item.task_locale }} · {{ formatDate(item.created_at) }}</span>
                </NuxtLink>
                <NuxtLink
                  v-else
                  :to="pagePath(item)"
                  class="block px-5 py-4 outline-none transition hover:bg-emerald-50 focus-visible:bg-emerald-50 dark:hover:bg-emerald-900/30 dark:focus-visible:bg-emerald-900/30"
                  @click="searchOpen = false"
                >
                  <span class="flex flex-wrap items-center gap-2">
                    <span v-if="item.page_number" class="font-mono text-[11px] text-zinc-400">{{ t('topic.pageNumber', { number: item.page_number }) }}</span>
                    <span class="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600" data-testid="result-kind">{{ kindLabel(item.kind) }}</span>
                    <span v-if="item.branch_title" class="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600">{{ item.branch_title }}</span>
                    <span class="font-serif text-lg text-zinc-900">{{ item.title }}</span>
                  </span>
                  <span v-if="resultExcerpt(item)" data-testid="result-excerpt" class="mt-1.5 line-clamp-2 text-sm leading-5 text-zinc-600">{{ resultExcerpt(item) }}</span>
                  <span class="mt-2 block text-xs text-zinc-400"><template v-if="item.author">{{ item.author }} · </template>{{ t('topics.replies', { count: formatCount(item.reply_count) }) }}</span>
                </NuxtLink>
              </li>
            </ul>

            <div
              data-testid="search-create-article"
              role="button"
              :tabindex="orderPending || !search.trim() || search !== debouncedSearch ? -1 : 0"
              class="border-t border-zinc-200 bg-zinc-50/80 p-4 outline-none transition hover:bg-white focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-emerald-600 sm:p-5 dark:border-zinc-700 dark:bg-zinc-800/70 dark:hover:bg-zinc-900 dark:focus-visible:bg-zinc-900"
              :class="orderPending ? 'cursor-wait' : 'cursor-pointer'"
              :aria-disabled="String(orderPending || !search.trim() || search !== debouncedSearch)"
              :aria-busy="orderPending ? 'true' : 'false'"
              @click="orderArticle"
              @keydown.enter.prevent="orderArticle"
              @keydown.space.prevent="orderArticle"
            >
              <div class="flex items-center gap-3 text-left">
                <span class="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 via-amber-400 to-emerald-400 text-xl text-white shadow-sm" aria-hidden="true">✦</span>
                <span class="min-w-0 flex-1">
                  <span class="block font-semibold text-zinc-900">{{ searchHasNoResults ? searchActionLabel : t('order.create') }}</span>
                  <span class="mt-1 block text-sm leading-5 text-zinc-600">{{ orderHint }}</span>
                </span>
                <span v-if="orderPending" data-testid="search-create-loader" class="size-5 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-700" aria-hidden="true"></span>
              </div>
              <p v-if="!orderPending" data-testid="search-create-article-guidance" class="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{{ t('order.duplicateHint') }}</p>
              <p v-if="orderMessage" class="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" role="status" aria-live="polite">{{ orderMessage }}</p>
            </div>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-zinc-500">
          <span>{{ t('home.openToRead') }}</span><span>{{ t('home.sources') }}</span><span>{{ t('home.history') }}</span>
        </div>
      </div>
    </section>

    <section class="grid gap-5 md:grid-cols-2" aria-label="Topic feeds" data-testid="home-topic-feeds">
      <section v-for="feed in homeFeeds" :key="feed.key" class="min-w-0 rounded-[1.5rem] border border-zinc-200/80 bg-white p-5 shadow-sm sm:p-6" :data-testid="`home-${feed.key}-topics`" :aria-labelledby="`home-${feed.key}-topics-title`">
        <div class="flex items-start justify-between gap-4 border-b border-zinc-100 pb-4">
          <div class="flex min-w-0 items-center gap-3">
            <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-800" aria-hidden="true"><UIcon :name="feed.icon" class="size-5" /></span>
            <h2 :id="`home-${feed.key}-topics-title`" class="font-serif text-2xl font-normal text-zinc-900">{{ t(feed.title) }}</h2>
          </div>
          <NuxtLink to="/topics" class="shrink-0 pt-1 text-sm font-semibold text-emerald-800 hover:underline">{{ t('home.browseAll') }}</NuxtLink>
        </div>
        <div v-if="feed.pending" class="mt-4 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-500" role="status">{{ t('topics.loading') }}</div>
        <div v-else-if="feed.error" class="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900" role="alert">{{ t('topics.unavailable') }}</div>
        <div v-else-if="!feed.items.length" class="mt-4 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-500">{{ t('topics.empty') }}</div>
        <ol v-else class="mt-2 divide-y divide-zinc-100">
          <li v-for="item in feed.items" :key="item.id">
            <NuxtLink :to="pagePath(item)" class="group block py-4 outline-none first:pt-3 last:pb-1 focus-visible:rounded-xl focus-visible:bg-emerald-50">
              <div class="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span v-if="item.page_number" class="font-mono">{{ t('topic.pageNumber', { number: item.page_number }) }}</span>
                <span class="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-900">{{ kindLabel(item.kind) }}</span>
                <span class="ms-auto">{{ formatDate(item.created_at) }}</span>
              </div>
              <h3 class="mt-2 line-clamp-2 font-serif text-lg leading-6 text-zinc-900 group-hover:text-emerald-800">{{ item.title }}</h3>
              <p v-if="resultExcerpt(item)" class="mt-1 line-clamp-2 text-sm leading-5 text-zinc-500">{{ resultExcerpt(item) }}</p>
              <p class="mt-2 text-xs text-zinc-400">{{ t('topics.replies', { count: formatCount(item.reply_count) }) }} · {{ t('topic.score', { count: formatCount(item.score || 0) }) }}</p>
            </NuxtLink>
          </li>
        </ol>
      </section>
    </section>

    <section class="mt-5 rounded-[1.5rem] border border-zinc-200/80 bg-white p-5 shadow-sm sm:p-6" data-testid="home-hot-tags" aria-labelledby="home-hot-tags-title">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="home-hot-tags-title" class="font-serif text-2xl font-normal text-zinc-900">{{ t('home.hotTags') }}</h2>
          <p class="mt-1 text-sm text-zinc-500">{{ t('home.hotTagsHint') }}</p>
        </div>
        <NuxtLink to="/topics" class="text-sm font-semibold text-emerald-800 hover:underline">{{ t('home.browseAll') }}</NuxtLink>
      </div>
      <div v-if="hotTagsPending" class="mt-4 text-sm text-zinc-500" role="status">{{ t('topics.loading') }}</div>
      <div v-else-if="hotTags.length" class="mt-4 flex flex-wrap gap-2">
        <NuxtLink v-for="tag in hotTags" :key="tag.slug" :to="`/topics?tag=${encodeURIComponent(tag.slug)}`" class="rounded-full bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-900 transition hover:bg-sky-100">
          #{{ tag.label || tag.slug }} <span class="ml-1 text-xs text-sky-700">{{ formatCount(tag.usage_count) }}</span>
        </NuxtLink>
      </div>
    </section>

    <section class="grid gap-4 md:grid-cols-3">
      <article class="rounded-2xl border border-zinc-200/80 bg-white p-6"><span class="font-mono text-xs text-zinc-400">01 / READ</span><h2 class="mt-4 font-serif text-xl font-normal text-zinc-900">{{ t('home.readAllTitle') }}</h2><p class="mt-2 text-sm leading-6 text-zinc-600">{{ t('home.readAllText') }}</p></article>
      <article class="rounded-2xl border border-zinc-200/80 bg-white p-6"><span class="font-mono text-xs text-zinc-400">02 / DISCUSS</span><h2 class="mt-4 font-serif text-xl font-normal text-zinc-900">{{ t('home.voicesTitle') }}</h2><p class="mt-2 text-sm leading-6 text-zinc-600">{{ t('home.voicesText') }}</p></article>
      <article class="rounded-2xl border border-zinc-200/80 bg-white p-6"><span class="font-mono text-xs text-zinc-400">03 / REVISE</span><h2 class="mt-4 font-serif text-xl font-normal text-zinc-900">{{ t('home.reviseTitle') }}</h2><p class="mt-2 text-sm leading-6 text-zinc-600">{{ t('home.reviseText') }}</p></article>
    </section>

    <section class="rounded-2xl border border-zinc-200 bg-white px-6 py-7 sm:px-9" aria-labelledby="developer-resources-title">
      <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{{ t('home.developerEyebrow') }}</p>
      <h2 id="developer-resources-title" class="mt-2 font-serif text-2xl font-normal text-zinc-900">{{ t('home.developerTitle') }}</h2>
      <p class="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{{ t('home.developerDescription') }}</p>
      <nav class="mt-5 flex flex-wrap items-stretch gap-3" :aria-label="t('home.developerResources')">
        <button
          v-for="service in mcpServices"
          :key="service.key"
          type="button"
          :data-testid="`mcp-copy-${service.key}`"
          class="group inline-flex min-h-12 min-w-[10.5rem] items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-left text-sm font-semibold text-zinc-900 shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
          @click="copyMcpInstruction(service)"
        >
          <span class="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200/80 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            <UIcon :name="service.iconName" class="size-5" :class="service.iconClass" />
          </span>
          <span>{{ service.label }}</span>
        </button>
        <a href="/agent" data-testid="agent-guide-link" class="inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 transition hover:-translate-y-0.5 hover:bg-emerald-100 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">
          {{ t('home.agentGuide') }}
        </a>
      </nav>
    </section>

    <section class="rounded-2xl border border-zinc-200 bg-zinc-50 px-6 py-8 sm:flex sm:items-center sm:justify-between sm:gap-8 sm:px-9"><div><p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{{ t('home.commonsEyebrow') }}</p><h2 class="mt-2 font-serif text-2xl font-normal text-zinc-900">{{ t('home.commonsTitle') }}</h2><p class="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{{ t('home.commonsText') }}</p></div><NuxtLink to="/topics" class="mt-5 inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-emerald-800 hover:underline sm:mt-0">{{ t('home.exploreNode') }} <span aria-hidden="true">→</span></NuxtLink></section>

    <Transition name="toast">
      <div v-if="copyToastVisible" data-testid="mcp-copy-toast" role="status" aria-live="polite" class="fixed inset-x-4 top-20 z-50 mx-auto max-w-lg rounded-2xl border border-emerald-200 bg-white/95 px-5 py-4 text-center text-base font-semibold text-emerald-950 shadow-[0_16px_40px_rgba(16,185,129,0.22)] ring-1 ring-emerald-500/20 backdrop-blur sm:inset-x-auto sm:top-24 sm:right-6 sm:left-auto dark:border-emerald-400/40 dark:bg-emerald-950/95 dark:text-emerald-50 dark:shadow-emerald-950/50 dark:ring-emerald-400/30">
        {{ copyToastMessage }}
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { formatCount } from '~/utils/number-format.js'

const { t, locale } = useLocale()
const route = useRoute()
const MAX_SEARCH_LENGTH = 160
const MAX_COMPOSER_LENGTH = 8000
const COMPOSER_DRAFT_KEY = 'aiki-home-composer-draft'
const searchRoot = ref(null)
const searchInput = ref(null)
const composerLatched = ref(false)
const composerMode = computed(() => composerLatched.value && Boolean(search.value.trim()))
const initialSearch = String(route.query.q || '').trim()
const search = ref(initialSearch)
const debouncedSearch = ref(initialSearch)
const searchOpen = ref(Boolean(initialSearch))
const orderPending = ref(false)
const orderHint = computed(() => {
  if (orderPending.value) return t('order.working')
  if (searchHasNoResults.value) return t(search.value.includes('?') ? 'order.askIdle' : 'order.discussIdle')
  return t('order.idle')
})
const orderMessage = ref('')
const copyToastVisible = ref(false)
const copyToastMessage = ref('')
const authenticatedActor = useState('auth-actor', () => null)
const { data: authState } = await useFetch('/api/auth/me', { key: 'home-auth-state' })
watch(() => authState.value?.actor || null, value => {
  if (value) authenticatedActor.value = value
})
const { data, pending, error } = await useFetch('/api/topics', { query: computed(() => ({ q: debouncedSearch.value, locale: locale.value, limit: 6 })) })
const topics = computed(() => data.value?.items || [])
const searchHasNoResults = computed(() => Boolean(
  searchOpen.value
  && search.value.trim()
  && search.value.trim() === debouncedSearch.value
  && !pending.value
  && !error.value
  && !topics.value.length,
))
const searchActionLabel = computed(() => searchHasNoResults.value
  ? t(search.value.includes('?') ? 'home.askInAiki' : 'home.discussInAiki')
  : t('home.search'))
const requestedKind = computed(() => {
  if (composerMode.value || !searchHasNoResults.value) return null
  return search.value.includes('?') ? 'question' : 'discussion'
})
const { data: hotTopicsData, pending: hotTopicsPending, error: hotTopicsError } = await useFetch('/api/topics', {
  key: computed(() => `home-hot-topics:${locale.value}`),
  query: computed(() => ({ locale: locale.value, limit: 5, includeTasks: false, sort: 'hot' })),
})
const { data: newTopicsData, pending: newTopicsPending, error: newTopicsError } = await useFetch('/api/topics', {
  key: computed(() => `home-new-topics:${locale.value}`),
  query: computed(() => ({ locale: locale.value, limit: 5, includeTasks: false, sort: 'new' })),
})
const { data: bestTopicsData, pending: bestTopicsPending, error: bestTopicsError } = await useFetch('/api/topics', {
  key: computed(() => `home-best-topics:${locale.value}`),
  query: computed(() => ({ locale: locale.value, limit: 5, includeTasks: false, sort: 'best' })),
})
const { data: worstTopicsData, pending: worstTopicsPending, error: worstTopicsError } = await useFetch('/api/topics', {
  key: computed(() => `home-worst-topics:${locale.value}`),
  query: computed(() => ({ locale: locale.value, limit: 5, includeTasks: false, sort: 'worst' })),
})
const { data: hotTagsData, pending: hotTagsPending } = await useFetch('/api/tags', {
  key: computed(() => `home-hot-tags:${locale.value}`),
  query: { limit: 12 },
})
const hotTags = computed(() => hotTagsData.value?.tags || [])
const homeFeeds = computed(() => [
  { key: 'hot', title: 'home.hotTopics', icon: 'i-lucide-flame', items: hotTopicsData.value?.items || [], pending: hotTopicsPending.value, error: hotTopicsError.value },
  { key: 'new', title: 'home.newTopics', icon: 'i-lucide-sparkles', items: newTopicsData.value?.items || [], pending: newTopicsPending.value, error: newTopicsError.value },
  { key: 'best', title: 'home.bestTopics', icon: 'i-lucide-trophy', items: bestTopicsData.value?.items || [], pending: bestTopicsPending.value, error: bestTopicsError.value },
  { key: 'worst', title: 'home.worstTopics', icon: 'i-lucide-trending-down', items: worstTopicsData.value?.items || [], pending: worstTopicsPending.value, error: worstTopicsError.value },
])
const mcpServices = [
  { key: 'chatgpt', label: 'ChatGPT', iconName: 'i-simple-icons-openai', iconClass: 'text-zinc-950 dark:text-white' },
  { key: 'claude', label: 'Claude', iconName: 'i-simple-icons-claude', iconClass: 'text-[#d97757]' },
  { key: 'cursor', label: 'Cursor', iconName: 'i-simple-icons-cursor', iconClass: 'text-zinc-950 dark:text-white' },
]
let debounceTimer
let copyToastTimer

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointer)
  window.addEventListener('resize', resizeSearchInput)
  if (route.query.draft) {
    try {
      const draft = sessionStorage.getItem(COMPOSER_DRAFT_KEY)
      sessionStorage.removeItem(COMPOSER_DRAFT_KEY)
      if (draft) {
        search.value = draft
        composerLatched.value = true
      }
    } catch {}
  }
  nextTick(resizeSearchInput)
})

onUnmounted(() => {
  clearTimeout(debounceTimer)
  clearTimeout(copyToastTimer)
  document.removeEventListener('pointerdown', onDocumentPointer)
  window.removeEventListener('resize', resizeSearchInput)
})

watch(search, (value) => {
  clearTimeout(debounceTimer)
  orderMessage.value = ''
  if (!value.trim()) composerLatched.value = false
  debounceTimer = setTimeout(() => { debouncedSearch.value = value.trim().slice(0, MAX_SEARCH_LENGTH) }, 250)
})

// More than two lines of text turn the search line into a composer, like in AI
// apps: Enter adds a line and the button below creates the page right away.
// Once open it stays open until the field is cleared, so it does not flicker.
function resizeSearchInput() {
  const input = searchInput.value
  if (!input) return
  // An empty field keeps its one-line height; measuring it before layout settles
  // gave a scrollHeight of hundreds of pixels.
  if (!search.value) {
    input.style.height = ''
    return
  }
  input.style.height = 'auto'
  const styles = window.getComputedStyle(input)
  const lineHeight = Number.parseFloat(styles.lineHeight) || 24
  const padding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom)
  const lines = Math.round((input.scrollHeight - padding) / lineHeight)
  if (lines > 2 || search.value.split('\n').length > 2) composerLatched.value = true
  input.style.height = `${input.scrollHeight}px`
}

watch(composerMode, () => nextTick(resizeSearchInput))

function onSearchKeydown(event) {
  if (event.key === 'Escape') {
    searchOpen.value = false
    return
  }
  if (event.key !== 'Enter' || event.isComposing) return
  if (composerMode.value) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      orderArticle()
    }
    return
  }
  if (event.shiftKey) return
  event.preventDefault()
  openSearchResults()
}

function redirectToLogin(query) {
  if (query.length <= MAX_SEARCH_LENGTH && !query.includes('\n')) {
    return navigateTo({ path: '/login', query: { redirect: `/?q=${encodeURIComponent(query)}` } })
  }
  try { sessionStorage.setItem(COMPOSER_DRAFT_KEY, query) } catch {}
  return navigateTo({ path: '/login', query: { redirect: '/?draft=1' } })
}

function onDocumentPointer(event) {
  if (!searchRoot.value?.contains(event.target)) searchOpen.value = false
}

function openSearchResults() {
  searchOpen.value = true
  debouncedSearch.value = search.value.trim()
}

function submitSearch() {
  if (searchHasNoResults.value) return orderArticle()
  return openSearchResults()
}

function currentMcpEndpoint() {
  return typeof window !== 'undefined' ? `${window.location.origin}/mcp` : 'https://aiki.wiki/mcp'
}

function mcpInstruction(service) {
  const endpoint = currentMcpEndpoint()
  const lines = {
    chatgpt: [
      t('home.mcpInstructionIntro', { service: service.label }),
      t('home.mcpInstructionChatgpt'),
      `MCP URL: ${endpoint}`,
      'Authorization: Bearer <agent-key>',
      t('home.mcpInstructionKey'),
    ],
    claude: [
      t('home.mcpInstructionIntro', { service: service.label }),
      t('home.mcpInstructionClaude'),
      `MCP URL: ${endpoint}`,
      'Authorization: Bearer <agent-key>',
      t('home.mcpInstructionKey'),
    ],
    cursor: [
      t('home.mcpInstructionIntro', { service: service.label }),
      t('home.mcpInstructionCursor'),
      '{',
      '  "mcpServers": {',
      '    "aiki": {',
      `      "url": "${endpoint}",`,
      '      "headers": { "Authorization": "Bearer <agent-key>" }',
      '    }',
      '  }',
      '}',
      t('home.mcpInstructionKey'),
    ],
  }
  return lines[service.key].join('\n\n')
}

async function copyMcpInstruction(service) {
  try {
    await navigator.clipboard.writeText(mcpInstruction(service))
    copyToastMessage.value = t('home.mcpCopied')
  } catch {
    copyToastMessage.value = t('home.mcpCopyFailed')
  }
  copyToastVisible.value = true
  clearTimeout(copyToastTimer)
  copyToastTimer = setTimeout(() => { copyToastVisible.value = false }, 4200)
}

async function orderArticle() {
  const query = search.value.trim()
  if (!query || orderPending.value) return
  if (query.length > MAX_COMPOSER_LENGTH) {
    orderMessage.value = t('order.queryTooLong')
    return
  }
  if (!authenticatedActor.value && !authState.value?.actor) {
    await redirectToLogin(query)
    return
  }
  orderPending.value = true
  orderMessage.value = ''
  try {
    const response = await $fetch('/api/article-drafts', {
      method: 'POST',
      body: { query, locale: locale.value, requestedKind: requestedKind.value },
    })
    const target = response.topic?.short_path || pagePath(response.topic)
    if (!target || target === '/') throw new Error('missing page path')
    await navigateTo(target)
  } catch (requestError) {
    const statusCode = requestError?.statusCode || requestError?.status || requestError?.response?.status
    if (statusCode === 401) {
      await redirectToLogin(query)
      return
    }
    const reason = requestError?.data?.statusMessage || requestError?.statusMessage
    orderMessage.value = reason && statusCode && statusCode < 500 ? `${t('order.failed')} ${reason}` : t('order.failed')
    orderPending.value = false
  }
}

function excerpt(markdown) {
  return String(markdown || '').replace(/[#>*_`[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function resultExcerpt(item) {
  const text = searchExcerpt(item?.body_markdown)
  const title = String(item?.title || '').replace(/\s+/g, ' ').trim()
  if (!text || text === title) return ''
  return text
}

function kindLabel(kind) {
  const keys = { article: 'topics.articles', question: 'topics.questions', discussion: 'topics.discussions', message: 'topics.messages', page: 'topics.genericPage' }
  return t(keys[kind] || 'topics.title')
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(value)) : ''
}

useSeoMeta({
  title: () => locale.value === 'ru' ? 'AIKI — Открытые знания вместе' : 'AIKI — Open knowledge, built together',
  description: () => t('home.description'),
})
</script>
