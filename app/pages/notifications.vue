<template>
  <section class="mx-auto max-w-3xl">
    <BackLink to="/account">{{ t('nav.account') }}</BackLink>
    <p class="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">{{ t('auth.accounts') }}</p>
    <h1 class="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">{{ t('notifications.title') }}</h1>
    <p class="mt-3 max-w-2xl leading-7 text-zinc-600">{{ t('notifications.description') }}</p>

    <p v-if="pending" role="status" class="mt-8 rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">{{ t('topics.loading') }}</p>
    <div v-else-if="statusCode === 401" role="alert" class="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
      <p>{{ t('notifications.signIn') }}</p>
      <NuxtLink to="/login" class="mt-3 inline-flex font-semibold text-emerald-900 underline">{{ t('auth.signIn') }}</NuxtLink>
    </div>
    <p v-else-if="error" role="alert" class="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">{{ t('notifications.unavailable') }}</p>
    <template v-else>
      <div role="group" :aria-label="t('notifications.filters')" data-testid="notification-filters" class="mt-6 flex flex-wrap gap-2">
        <button
          v-for="filter in filters"
          :key="filter.id"
          type="button"
          :data-testid="`notification-filter-${filter.id}`"
          :aria-pressed="activeFilter === filter.id"
          class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          :class="activeFilter === filter.id ? 'border-transparent bg-[var(--aiki-accent)] text-[var(--aiki-accent-ink)]' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'"
          @click="activeFilter = filter.id"
        >
          <UIcon :name="filter.icon" class="size-4 shrink-0" aria-hidden="true" />
          {{ t(filter.label) }}
          <span class="font-mono text-xs opacity-80">{{ formatCount(counts[filter.id]) }}</span>
        </button>
      </div>

      <p v-if="!items.length" data-testid="notifications-empty" class="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-600">{{ t('notifications.empty') }}</p>
      <p v-else-if="!visible.length" data-testid="notification-filter-empty" class="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-600">{{ t('notifications.filterEmpty') }}</p>
      <ol v-else class="mt-6 divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white" data-testid="notifications-list">
        <li v-for="item in visible" :key="item.id" :data-testid="`notification-${item.kind}`" :data-unread="item.unread ? 'true' : 'false'">
          <NuxtLink :to="item.href" class="flex gap-3 px-4 py-4 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 sm:px-5" :class="item.unread ? 'bg-emerald-50/60' : ''">
            <span :data-testid="`notification-icon-${item.kind}`" class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full" :class="iconClass(item.kind)">
              <UIcon :name="kindIcon(item.kind)" class="size-4" aria-hidden="true" />
            </span>
            <span class="min-w-0">
              <span class="block text-sm font-semibold leading-6 text-zinc-950">{{ line(item) }}</span>
              <span v-if="item.excerpt" class="mt-1 line-clamp-2 block text-sm leading-6 text-zinc-600">{{ item.excerpt }}</span>
              <span class="mt-2 block text-xs text-zinc-400">{{ formatDate(item.createdAt) }}</span>
            </span>
          </NuxtLink>
        </li>
      </ol>
    </template>
  </section>
</template>

<script setup>
import { formatCount } from '~/utils/number-format.js'

const FILTERS = [
  { id: 'all', icon: 'i-lucide-inbox', label: 'notifications.filter.all' },
  { id: 'unread', icon: 'i-lucide-bell', label: 'notifications.filter.unread' },
  { id: 'edits', icon: 'i-lucide-pencil', label: 'notifications.filter.edits' },
  { id: 'comments', icon: 'i-lucide-message-square', label: 'notifications.filter.comments' },
  { id: 'transfers', icon: 'i-lucide-arrow-right-left', label: 'notifications.filter.transfers' },
]

const KIND_ICONS = {
  edit_proposal: 'i-lucide-pencil',
  proposal_accepted: 'i-lucide-circle-check',
  proposal_rejected: 'i-lucide-circle-x',
  page_comment: 'i-lucide-message-square',
  comment_reply: 'i-lucide-reply',
  page_transfer: 'i-lucide-arrow-right-left',
  task_solution: 'i-lucide-clipboard-check',
  mention: 'i-lucide-at-sign',
}

const EDIT_KINDS = new Set(['edit_proposal', 'proposal_accepted', 'proposal_rejected', 'task_solution'])
const COMMENT_KINDS = new Set(['page_comment', 'comment_reply', 'mention'])

const { t, locale } = useLocale()
const { data, error, pending } = await useFetch('/api/notifications', {
  query: computed(() => ({ locale: locale.value })),
})
const items = computed(() => data.value?.items || [])
const statusCode = computed(() => error.value?.statusCode || error.value?.status || null)
const filters = FILTERS
const activeFilter = ref('all')

const counts = computed(() => ({
  all: items.value.length,
  unread: items.value.filter(item => item.unread).length,
  edits: items.value.filter(item => EDIT_KINDS.has(item.kind)).length,
  comments: items.value.filter(item => COMMENT_KINDS.has(item.kind)).length,
  transfers: items.value.filter(item => item.kind === 'page_transfer').length,
}))

const visible = computed(() => items.value.filter(item => {
  if (activeFilter.value === 'unread') return item.unread
  if (activeFilter.value === 'edits') return EDIT_KINDS.has(item.kind)
  if (activeFilter.value === 'comments') return COMMENT_KINDS.has(item.kind)
  if (activeFilter.value === 'transfers') return item.kind === 'page_transfer'
  return true
}))

function kindIcon(kind) {
  return KIND_ICONS[kind] || 'i-lucide-bell'
}

function iconClass(kind) {
  if (kind === 'proposal_rejected') return 'bg-amber-50 text-amber-900'
  if (kind === 'page_comment' || kind === 'comment_reply') return 'bg-zinc-100 text-zinc-700'
  return 'bg-emerald-50 text-emerald-900'
}

function line(item) {
  return t(`notifications.kind.${item.kind}`, {
    name: item.actor?.displayName || item.actor?.username || t('topic.activityCommunity'),
    title: item.title || t('notifications.untitled'),
  })
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''
}

onMounted(async () => {
  if (!items.value.some(item => item.unread)) return
  try {
    await $fetch('/api/notifications/read', { method: 'POST', body: {} })
    await refreshNuxtData('notifications-unread')
  } catch {
    // The list stays readable if marking seen fails.
  }
})

useSeoMeta({ title: () => `${t('notifications.title')} · AIKI`, robots: 'noindex, nofollow' })
</script>
