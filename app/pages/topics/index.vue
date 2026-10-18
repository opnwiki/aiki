<template>
  <section>
    <BackLink to="/">{{ t('topics.home') }}</BackLink>
    <div class="mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p class="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">AIKI node</p><h1 class="mt-2 text-3xl font-semibold tracking-tight">{{ t('topics.title') }}</h1></div>
      <form class="flex w-full gap-2 sm:max-w-md" @submit.prevent="applySearch">
        <label class="sr-only" for="topics-query">{{ t('topics.search') }}</label>
        <input id="topics-query" v-model="draftSearch" type="search" maxlength="160" :placeholder="t('topics.searchPlaceholder')" class="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100">
        <UButton type="submit" color="primary">{{ t('topics.search') }}</UButton>
      </form>
    </div>
    <p class="mt-4 text-sm text-zinc-500">{{ t('topics.description') }}</p>

    <div v-if="actor" class="mt-6">
      <UButton
        type="button"
        color="primary"
        :icon="showComposer ? undefined : 'i-lucide-plus'"
        @click="showComposer = !showComposer"
      >{{ showComposer ? t('topics.closeComposer') : t('topics.start') }}</UButton>
      <TopicComposer v-if="showComposer" :actor="actor" class="mt-4" />
    </div>
    <div v-else class="mt-6 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{{ t('topics.readingOpen') }} <NuxtLink to="/login" class="font-semibold underline">{{ t('topics.signUpToStart') }}</NuxtLink>{{ t('topics.toStart') }}</div>

    <section v-if="canImportFederation" data-testid="federation-import" class="mt-5 rounded-2xl border border-sky-200 bg-sky-50/60 p-5">
      <h2 class="text-sm font-semibold text-zinc-950">{{ t('topics.federationImportTitle') }}</h2>
      <p class="mt-1 text-sm leading-6 text-zinc-600">{{ t('topics.federationImportHint') }}</p>
      <form class="mt-3 flex flex-col gap-2 sm:flex-row" @submit.prevent="importThread">
        <label class="min-w-0 flex-1"><span class="sr-only">{{ t('topics.federationImportUrl') }}</span><input v-model="federationUrl" data-testid="federation-import-url" type="url" required maxlength="500" class="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm" :placeholder="t('topics.federationImportPlaceholder')"></label>
        <UButton type="submit" color="primary" :loading="federationImporting">{{ federationImporting ? t('topics.federationImporting') : t('topics.federationImportAction') }}</UButton>
      </form>
      <p v-if="federationImportError" role="alert" class="mt-2 text-sm text-rose-800">{{ federationImportError }}</p>
      <p v-if="federationImportResult" role="status" class="mt-2 text-sm text-emerald-900">{{ t('topics.federationImportDone') }} <NuxtLink v-if="federationImportResult.topicSlug" :to="`/${federationImportResult.topicSlug}`" class="font-semibold underline">{{ t('topics.federationImportOpen') }}</NuxtLink></p>
    </section>

    <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-zinc-500">{{ t('topics.count', { count: formatCount(total) }) }}{{ activeQuery ? t('topics.matching', { query: activeQuery }) : '' }}</p>
      <label class="flex items-center gap-2 text-sm text-zinc-600">{{ t('topics.type') }}
        <select v-model="kind" class="rounded-lg border border-zinc-200 bg-white px-3 py-2" @change="applySearch">
          <option value="">{{ t('topics.all') }}</option><option value="article">{{ t('topics.articles') }}</option><option value="question">{{ t('topics.questions') }}</option><option value="discussion">{{ t('topics.discussions') }}</option><option value="message">{{ t('topics.messages') }}</option>
        </select>
      </label>
      <label class="flex min-w-64 flex-1 items-center gap-2 text-sm text-zinc-600 sm:flex-none">{{ t('topics.tagFilter') }}
        <input v-model="tagDraft" type="text" maxlength="240" :placeholder="t('topics.tagsPlaceholder')" class="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 sm:w-72" @keyup.enter="applySearch">
      </label>
    </div>
    <p v-if="tagFilter" class="mt-2 text-xs text-zinc-500">{{ t('topics.tagsHint') }} {{ tagFilter }}</p>

    <div v-if="pending" class="mt-4 rounded-2xl border border-zinc-200 bg-white p-6" role="status">{{ t('topics.loading') }}</div>
    <div v-else-if="error" class="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">{{ t('topics.unavailable') }}</div>
    <div v-else-if="!items.length" class="mt-4 rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-500">{{ t('topics.empty') }}</div>
    <div v-else class="mt-4 divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white px-6">
      <article v-for="topic in items" :key="topic.id" class="py-5 first:pt-6 last:pb-6">
        <div class="flex flex-wrap items-center gap-2">
          <span v-if="topic.page_number" class="font-mono text-xs text-zinc-400">{{ t('topic.pageNumber', { number: topic.page_number }) }}</span>
          <span class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold capitalize text-emerald-900">{{ kindLabel(topic.kind) }}</span>
          <NuxtLink v-if="topic.branch_slug" :to="`/branches/${encodeURIComponent(topic.branch_slug)}`" class="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:text-emerald-900">{{ topic.branch_title }}</NuxtLink>
          <span v-for="tag in topic.tags || []" :key="tag.slug" class="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-900">#{{ tag.label || tag.slug }}</span>
          <span class="text-xs text-zinc-400">{{ t('topics.replies', { count: formatCount(topic.reply_count) }) }} · {{ t('topics.upvotes', { count: formatCount(topic.upvotes) }) }}</span>
        </div>
        <h2 class="mt-2 text-lg font-semibold">
          <NuxtLink v-if="topic.slug || topic.page_number" :to="pagePath(topic)" class="hover:text-emerald-800">{{ topic.title }}</NuxtLink>
          <span v-else>{{ topic.title }}</span>
        </h2>
        <p v-if="resultExcerpt(topic)" data-testid="result-excerpt" class="mt-1 line-clamp-2 text-sm leading-5 text-zinc-500">{{ resultExcerpt(topic) }}</p>
        <p class="mt-3 text-xs text-zinc-400"><template v-if="topic.author">{{ topic.author }} · </template>{{ formatDate(topic.created_at) }}</p>
      </article>
    </div>
    <nav v-if="pages > 1" class="mt-6 flex items-center justify-between" aria-label="Topic pages">
      <UButton color="neutral" variant="outline" :disabled="page <= 1" @click="changePage(page - 1)">{{ t('topics.previous') }}</UButton>
      <span class="text-sm text-zinc-500">{{ t('topics.page', { page, pages }) }}</span>
      <UButton color="neutral" variant="outline" :disabled="page >= pages" @click="changePage(page + 1)">{{ t('topics.next') }}</UButton>
    </nav>
  </section>
</template>

<script setup>
import { formatCount } from '~/utils/number-format.js'

const { t, locale } = useLocale()
const route = useRoute()
const router = useRouter()
const { data: authState } = await useFetch('/api/auth/me')
const actor = computed(() => authState.value?.actor || null)
// Thread import stays admin-only until moderation of imported threads is settled.
const canImportFederation = computed(() => ['owner', 'admin'].includes(actor.value?.role))
const showComposer = ref(false)
const federationUrl = ref('')
const federationImporting = ref(false)
const federationImportError = ref('')
const federationImportResult = ref(null)
const draftSearch = ref(String(route.query.q || '').slice(0, 160))
const activeQuery = ref(String(route.query.q || '').slice(0, 160))
const kind = ref(['article', 'question', 'discussion', 'message'].includes(route.query.kind) ? String(route.query.kind) : '')
const tagDraft = ref(String(route.query.tag || route.query.tags || '').slice(0, 240))
const tagFilter = ref(tagDraft.value)
const page = ref(Math.max(1, Number.parseInt(String(route.query.page || '1'), 10) || 1))
const limit = 20
const { data, pending, error, refresh } = await useFetch('/api/topics', {
  query: computed(() => ({ q: activeQuery.value, kind: kind.value, tags: tagFilter.value, locale: locale.value, limit, offset: (page.value - 1) * limit })),
})
const items = computed(() => data.value?.items || [])
const total = computed(() => Number(data.value?.total || 0))
const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)))

async function applySearch() {
  activeQuery.value = draftSearch.value.trim().slice(0, 160)
  tagFilter.value = tagDraft.value.trim().replace(/\s*,\s*/g, ',').slice(0, 240)
  page.value = 1
  await syncRoute()
  await refresh()
}

async function importThread() {
  federationImporting.value = true
  federationImportError.value = ''
  federationImportResult.value = null
  try {
    federationImportResult.value = await $fetch('/api/federation/import', { method: 'POST', body: { url: federationUrl.value.trim() } })
    federationUrl.value = ''
  } catch (error) {
    federationImportError.value = error?.data?.statusMessage || error?.statusMessage || t('topics.federationImportFailed')
  } finally {
    federationImporting.value = false
  }
}

async function changePage(nextPage) {
  page.value = Math.min(Math.max(1, nextPage), pages.value)
  await syncRoute()
  await refresh()
}

async function syncRoute() {
  await router.replace({ query: { ...(activeQuery.value ? { q: activeQuery.value } : {}), ...(kind.value ? { kind: kind.value } : {}), ...(tagFilter.value ? { tag: tagFilter.value } : {}), ...(page.value > 1 ? { page: String(page.value) } : {}) } })
}

function resultExcerpt(item) {
  const text = searchExcerpt(item?.body_markdown)
  const title = String(item?.title || '').replace(/\s+/g, ' ').trim()
  if (!text || text === title) return ''
  return text
}

function kindLabel(value) {
  return t(({ article: 'topics.articles', question: 'topics.questions', discussion: 'topics.discussions', message: 'topics.messages' })[value] || 'topics.title')
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(value)) : ''
}

useSeoMeta({ title: () => `${t('topics.title')} · AIKI`, description: () => t('topics.description') })
</script>
