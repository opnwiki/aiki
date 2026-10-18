<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-3 backdrop-blur-sm sm:p-6" data-testid="revision-history-backdrop" @click.self="emit('close')">
      <section ref="dialog" role="dialog" aria-modal="true" aria-labelledby="revision-history-title" class="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 sm:rounded-3xl" data-testid="revision-history-dialog" @keydown="handleDialogKeydown">
        <header class="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800 sm:px-7 sm:py-5">
          <div>
            <h2 id="revision-history-title" class="font-serif text-2xl font-normal text-zinc-950 dark:text-zinc-50">{{ t('topic.revisionHistory') }}</h2>
            <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{{ t('topic.revisionHistoryDescription') }}</p>
            <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{{ t('topic.changeRestore') }}</p>
          </div>
          <button ref="closeButton" type="button" class="grid size-10 shrink-0 place-items-center rounded-full border border-zinc-200 text-xl text-zinc-600 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" :aria-label="t('topic.reportClose')" @click="emit('close')">×</button>
        </header>
        <div id="article-history" class="min-h-0 flex-1 overflow-y-auto" :class="showSidebar ? 'grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]' : ''">
          <section class="min-w-0 p-5 sm:p-7" :aria-label="t('topic.revisionHistory')">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <span class="text-xs text-zinc-500 dark:text-zinc-400">{{ t('topic.historyLocale', { locale: topic.locale }) }}</span>
              <span v-if="chronologicalRevisions.length" class="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{{ formatCount(selectedIndex + 1) }} / {{ formatCount(total || chronologicalRevisions.length) }}</span>
            </div>
            <p v-if="error" role="alert" class="mt-4 text-sm text-red-800 dark:text-red-200">{{ error }}</p>
            <template v-else-if="selectedRevision">
              <article class="mt-4 min-h-64 rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-700 dark:bg-zinc-800/70 sm:p-6" data-testid="revision-current-selection">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <h3 class="font-serif text-xl font-medium text-zinc-950 dark:text-zinc-50"><NuxtLink :to="revisionPath(selectedRevision.id)" class="underline decoration-emerald-300 underline-offset-4 hover:text-emerald-900 dark:hover:text-emerald-300">{{ selectedRevision.title }}</NuxtLink>
                      <span v-if="selectedRevision.is_current" class="ml-2 inline-block rounded-full bg-emerald-50 px-2 py-0.5 align-middle font-sans text-xs text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">{{ t('topic.currentRevision') }}</span>
                    </h3>
                    <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400"><span v-if="revisionAuthor(selectedRevision)">{{ revisionAuthor(selectedRevision) }} · </span><time :datetime="selectedRevision.created_at">{{ formatDateTime(selectedRevision.created_at) }}</time></p>
                  </div>
                  <code class="text-xs text-zinc-400 dark:text-zinc-500">{{ selectedRevision.id.slice(0, 8) }}</code>
                </div>
                <p v-if="selectedRevision.summary" class="mt-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{{ selectedRevision.summary }}</p>
                <p v-if="selectedRevision.summary_changed" class="mt-4 rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100" data-testid="revision-overview-update">
                  {{ t('topic.overviewHistory') }}<span v-if="revisionAuthor(selectedRevision)"> · {{ revisionAuthor(selectedRevision) }}</span> · <time :datetime="selectedRevision.created_at">{{ formatDateTime(selectedRevision.created_at) }}</time>
                </p>
                <div v-if="selectedRevision.change" class="mt-4 space-y-2 text-xs text-zinc-600 dark:text-zinc-300" data-testid="revision-change">
                  <p data-testid="revision-introduced">{{ t('topic.changeIntroduced', { name: changeName(selectedRevision.change.introducedBy, selectedRevision.change.introducedLabel) }) }} · <time :datetime="selectedRevision.change.introducedAt">{{ formatDateTime(selectedRevision.change.introducedAt) }}</time></p>
                  <p data-testid="revision-confirmed">{{ t('topic.changeConfirmed', { name: changeName(selectedRevision.change.confirmedBy, selectedRevision.change.confirmedLabel, selectedRevision.change.origin) }) }} · <time :datetime="selectedRevision.change.confirmedAt">{{ formatDateTime(selectedRevision.change.confirmedAt) }}</time></p>
                  <pre v-if="selectedRevision.change.body.lines.length" data-testid="revision-diff" class="mt-3 max-h-[45vh] max-w-full overflow-auto rounded-lg bg-zinc-950 p-3 text-xs leading-6 text-zinc-100"><code><span v-for="(line, index) in selectedRevision.change.body.lines" :key="index" class="block whitespace-pre-wrap break-words" :class="diffLineClass(line.type)">{{ diffPrefix(line.type) }}{{ line.text }}</span></code></pre>
                  <p v-else class="text-zinc-500 dark:text-zinc-400">{{ t('topic.noBodyChanges') }}</p>
                </div>
              </article>
              <nav class="mt-4 flex items-center justify-between gap-3" :aria-label="t('topic.revisionHistory')">
                <button type="button" class="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800" :disabled="selectedIndex <= 0" @click="selectedIndex--">← {{ t('topics.previous') }}</button>
                <span class="text-center text-xs text-zinc-500 dark:text-zinc-400">{{ t('topic.historyLocale', { locale: topic.locale }) }}</span>
                <button type="button" class="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800" :disabled="selectedIndex >= chronologicalRevisions.length - 1" @click="selectedIndex++">{{ t('topics.next') }} →</button>
              </nav>
            </template>
            <p v-else-if="!error" class="mt-5 text-sm text-zinc-500 dark:text-zinc-400">{{ t('topic.noRevisionHistory') }}</p>
            <button v-if="chronologicalRevisions.length < total" type="button" class="mt-4 text-sm font-semibold text-emerald-800 underline dark:text-emerald-300" :disabled="pending" @click="loadMore">{{ pending ? t('topic.loading') : t('topic.moreRevisions') }}</button>
          </section>
          <aside v-if="showSidebar" id="article-proposals" class="min-w-0 border-t border-zinc-100 bg-zinc-50/60 p-5 dark:border-zinc-800 dark:bg-zinc-950/40 sm:p-7 lg:border-l lg:border-t-0" :aria-label="t('topic.proposals')">
            <slot />
          </aside>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { formatCount } from '~/utils/number-format.js'

const props = defineProps({ topic: { type: Object, required: true }, open: { type: Boolean, default: false }, showSidebar: { type: Boolean, default: true } })
const emit = defineEmits(['close'])
const showSidebar = computed(() => props.showSidebar)
const { t, locale } = useLocale()
const { public: { nodeDomain } } = useRuntimeConfig()
const slug = computed(() => encodeURIComponent(String(props.topic.slug || '')))
const { data, error: fetchError, refresh: reloadRevisions } = await useFetch(() => `/api/topics/${slug.value}/revisions?locale=${encodeURIComponent(props.topic.locale || 'en')}&limit=20&offset=0`)
watch(() => props.topic.hideAuthor, () => { void reloadRevisions() })
const revisions = ref([])
const total = ref(0)
watch(data, (value) => {
  revisions.value = value?.items || []
  total.value = value?.total || 0
}, { immediate: true })
const pending = ref(false)
const error = computed(() => fetchError.value?.data?.statusMessage || '')
const chronologicalRevisions = computed(() => [...revisions.value].reverse())
const selectedIndex = ref(0)
const selectedRevision = computed(() => chronologicalRevisions.value[selectedIndex.value] || null)
const dialog = ref(null)
const closeButton = ref(null)

watch(() => props.open, async (isOpen) => {
  if (typeof document === 'undefined') return
  if (isOpen) {
    await nextTick()
    closeButton.value?.focus()
  }
})

onMounted(() => window.addEventListener('keydown', handleWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleWindowKeydown))

function handleWindowKeydown(event) {
  if (props.open && event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

function handleDialogKeydown(event) {
  if (event.key !== 'Tab') return
  const items = [...dialog.value.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  if (!items.length) {
    event.preventDefault()
    closeButton.value?.focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && (document.activeElement === first || !dialog.value.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.value.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

async function loadMore() {
  if (pending.value || revisions.value.length >= total.value) return
  pending.value = true
  try {
    const next = await $fetch(`/api/topics/${slug.value}/revisions?locale=${encodeURIComponent(props.topic.locale || 'en')}&limit=20&offset=${revisions.value.length}`)
    revisions.value.push(...next.items)
    total.value = next.total
  } catch (requestError) {
    fetchError.value = requestError
  } finally {
    pending.value = false
  }
}

function revisionAuthor(revision) {
  if (!revision.author && props.topic.hideAuthor) return ''
  return revision.author_display_name || `${revision.author || 'community'}@${nodeDomain}`
}

function revisionPath(id) {
  return `/${slug.value}/revisions/${id}`
}

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
</script>
