<template>
  <main v-if="revision" class="mx-auto max-w-4xl">
    <BackLink :to="`/${slug}`">{{ t('topic.backToArticle') }}</BackLink>
    <div class="mt-8 flex flex-wrap items-center gap-2">
      <span class="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700">{{ t('topic.revisionLabel', { locale: revision.locale }) }}</span>
      <span v-if="revision.is_current" class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">{{ t('topic.currentRevision') }}</span>
      <code class="min-w-0 break-words text-xs text-zinc-400">{{ revision.id }}</code>
    </div>
    <h1 class="mt-4 break-words text-3xl font-semibold leading-tight sm:text-5xl">{{ revision.title }}</h1>
    <div class="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-zinc-500">
      <span v-if="!revision.authorHidden">{{ revision.author_display_name || `${revision.author || 'community'}@${nodeDomain}` }}</span>
      <time :datetime="revision.created_at">{{ formatDateTime(revision.created_at) }}</time>
    </div>
    <p v-if="revision.summary" class="mt-4 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-700">{{ revision.summary }}</p>
    <section v-if="revision.change" data-testid="revision-change" class="mt-6 rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 class="font-semibold">{{ t('topic.viewDiff') }}</h2>
      <p class="mt-2 text-sm text-zinc-600" data-testid="revision-introduced">{{ t('topic.changeIntroduced', { name: changeName(revision.change.introducedBy, revision.change.introducedLabel) }) }} · <time :datetime="revision.change.introducedAt">{{ formatDateTime(revision.change.introducedAt) }}</time></p>
      <p class="mt-1 text-sm text-zinc-600" data-testid="revision-confirmed">{{ t('topic.changeConfirmed', { name: changeName(revision.change.confirmedBy, revision.change.confirmedLabel, revision.change.origin) }) }} · <time :datetime="revision.change.confirmedAt">{{ formatDateTime(revision.change.confirmedAt) }}</time></p>
      <pre v-if="revision.change.body.lines.length" data-testid="revision-diff" class="mt-4 max-h-96 max-w-full overflow-auto rounded-lg bg-zinc-950 p-4 text-xs leading-6 text-zinc-100"><code><span v-for="(line, index) in revision.change.body.lines" :key="index" class="block whitespace-pre-wrap break-words" :class="diffLineClass(line.type)">{{ diffPrefix(line.type) }}{{ line.text }}</span></code></pre>
      <p v-else class="mt-3 text-sm text-zinc-500">{{ t('topic.noBodyChanges') }}</p>
    </section>
    <article class="mt-8 rounded-3xl border border-zinc-200 bg-white px-6 py-7 sm:px-10 sm:py-9">
      <div class="prose-aiki max-w-none text-[1.03rem]" v-html="revision.html"></div>
    </article>
    <section v-if="revision.citations?.length" class="mt-8 rounded-2xl border border-zinc-200 bg-zinc-50 p-6">
      <h2 class="text-lg font-semibold">{{ t('topic.sources') }}</h2>
      <p v-if="!revision.citations.length" class="mt-2 text-sm text-zinc-500">{{ t('topic.noSources') }}</p>
      <ul v-else class="mt-3 space-y-3">
        <li v-for="source in revision.citations" :key="source.id" class="text-sm">
          <a :href="source.canonical_url" target="_blank" rel="nofollow noopener noreferrer" class="font-medium text-emerald-800 underline">{{ source.title || source.canonical_url }}</a>
          <span v-if="source.publisher" class="ml-2 text-zinc-500">· {{ source.publisher }}</span>
          <p v-if="source.locator || source.note" class="mt-1 text-zinc-500">{{ [source.locator, source.note].filter(Boolean).join(' — ') }}</p>
        </li>
      </ul>
    </section>
    <section v-if="revision.parent" class="mt-8 rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 class="font-semibold">{{ t('topic.parentRevision') }}</h2>
      <p class="mt-2 text-sm"><NuxtLink :to="`/${slug}/revisions/${revision.parent.id}`" class="text-emerald-800 underline">{{ revision.parent.title }}</NuxtLink></p>
    </section>
  </main>
  <section v-else class="mx-auto max-w-2xl rounded-2xl border border-zinc-200 bg-white p-8">
    <BackLink to="/topics">{{ t('topic.all') }}</BackLink>
    <h1 class="mt-5 text-2xl font-semibold">{{ t('topic.revisionUnavailable') }}</h1>
    <p class="mt-2 text-zinc-500">{{ t('topic.notFound') }}</p>
  </section>
</template>

<script setup>
const route = useRoute()
const { t, locale } = useLocale()
const { public: { nodeDomain, siteUrl } } = useRuntimeConfig()
const slug = computed(() => encodeURIComponent(String(route.params.slug || '')))
const revisionId = computed(() => encodeURIComponent(String(route.params.revisionId || '')))
const canonicalUrl = computed(() => `${String(siteUrl).replace(/\/$/, '')}/${slug.value}/revisions/${revisionId.value}`)
const { data: revision } = await useFetch(() => `/api/topics/${slug.value}/revisions/${revisionId.value}`)

function formatDateTime(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''
}

function changeName(account, label, origin) {
  if (account?.displayName) return account.displayName
  if (account?.username) return `${account.username}@${nodeDomain}`
  if (label) return label
  if (origin === 'translation') return t('topic.changeAutomatic')
  return t('topic.changeMachine')
}

function diffPrefix(type) {
  return type === 'removed' ? '− ' : type === 'added' ? '+ ' : type === 'gap' ? '' : '  '
}

function diffLineClass(type) {
  return type === 'removed' ? 'bg-red-950 text-red-200' : type === 'added' ? 'bg-emerald-950 text-emerald-200' : type === 'gap' ? 'text-zinc-400' : 'text-zinc-300'
}

useHead(() => ({ link: [{ rel: 'canonical', href: canonicalUrl.value }] }))
useSeoMeta({
  title: () => revision.value ? `${revision.value.title} · ${t('topic.revisionLabel', { locale: revision.value.locale })} · AIKI` : 'Revision · AIKI',
  description: () => revision.value?.summary || revision.value?.body_markdown?.slice(0, 155) || 'A historical AIKI article revision.',
})
</script>
