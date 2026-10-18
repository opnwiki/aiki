<template>
  <section>
    <BackLink to="/branches">{{ t('branches.open') }}</BackLink>
    <div v-if="error" class="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">{{ t('branches.notFound') }}</div>
    <template v-else-if="branch">
      <div class="mt-5">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">{{ t('branches.title') }}</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">{{ branch.title }}</h1>
        <p v-if="branch.description" class="mt-4 max-w-2xl text-sm leading-6 text-zinc-600">{{ branch.description }}</p>
        <p class="mt-3 text-sm text-zinc-500">
          <span v-if="branch.leader">{{ t('branches.leader') }}: {{ branch.leader }} · </span>
          {{ t('branches.topicCount', { count: formatCount(branch.topic_count) }) }}
        </p>
      </div>

      <div v-if="actor" class="mt-6">
        <UButton type="button" color="primary" :icon="showComposer ? undefined : 'i-lucide-plus'" @click="showComposer = !showComposer">
          {{ showComposer ? t('topics.closeComposer') : t('branches.publishHere') }}
        </UButton>
        <TopicComposer v-if="showComposer" :actor="actor" :branch="branch" class="mt-4" />
      </div>
      <p v-else class="mt-6 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{{ t('topics.readingOpen') }} <NuxtLink to="/login" class="font-semibold underline">{{ t('topics.signUpToStart') }}</NuxtLink>{{ t('topics.toStart') }}</p>

      <div v-if="!topics.length" class="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-500">{{ t('branches.emptyTopics') }}</div>
      <div v-else class="mt-6 divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white px-6">
        <NuxtLink v-for="topic in topics" :key="topic.slug" :to="pagePath(topic)" class="block py-5 first:pt-6 last:pb-6">
          <span v-if="topic.page_number" class="mr-2 font-mono text-xs text-zinc-400">{{ t('topic.pageNumber', { number: topic.page_number }) }}</span>
          <span class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900">{{ kindLabel(topic.kind) }}</span>
          <h2 class="mt-2 text-lg font-semibold">{{ topic.title }}</h2>
          <p class="mt-2 text-xs text-zinc-400">{{ topic.author || 'community' }} · {{ formatDate(topic.created_at) }}</p>
        </NuxtLink>
      </div>
    </template>
  </section>
</template>

<script setup>
import { formatCount } from '~/utils/number-format.js'

const { t, locale } = useLocale()
const route = useRoute()
const slug = computed(() => String(route.params.slug || ''))
const { data: authState } = await useFetch('/api/auth/me')
const actor = computed(() => authState.value?.actor || null)
const { data, error } = await useFetch(() => `/api/branches/${encodeURIComponent(slug.value)}`, {
  query: computed(() => ({ locale: locale.value })),
})
const branch = computed(() => data.value?.branch || null)
const topics = computed(() => data.value?.topics || [])
const showComposer = ref(false)

function kindLabel(value) {
  return t(({ article: 'topics.articles', question: 'topics.questions', discussion: 'topics.discussions', message: 'topics.messages' })[value] || 'topics.title')
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(value)) : ''
}

useSeoMeta({
  title: () => branch.value ? `${branch.value.title} · AIKI` : `${t('branches.title')} · AIKI`,
  description: () => branch.value?.description || t('branches.description'),
})
</script>
