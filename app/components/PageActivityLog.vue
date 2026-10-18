<template>
  <section id="article-activity" data-testid="page-activity" class="mt-8 scroll-mt-24 rounded-[1.75rem] border border-zinc-200/80 bg-white p-6 shadow-sm sm:p-8">
    <div class="border-b border-zinc-100 pb-4">
      <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800">AIKI</p>
      <h2 class="mt-2 font-serif text-2xl font-medium text-zinc-950">{{ t('topic.activityTitle') }}</h2>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{{ t('topic.activityDescription') }}</p>
    </div>
    <p v-if="error" role="alert" class="mt-4 text-sm text-red-800">{{ error }}</p>
    <p v-else-if="!items.length" class="mt-4 text-sm text-zinc-500">{{ t('topic.activityEmpty') }}</p>
    <ol v-else class="mt-2 divide-y divide-zinc-100">
      <li v-for="item in displayedItems" :key="`${item.kind}-${item.refId}`" data-testid="page-activity-item" class="py-4">
        <p class="text-sm leading-6 text-zinc-800">{{ sentence(item) }}</p>
        <p v-if="item.title" class="mt-1 break-words text-sm font-medium text-zinc-950">{{ item.title }}</p>
        <p v-if="item.detail" class="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-600">{{ item.detail }}</p>
        <time :datetime="item.at" class="mt-1 block text-xs text-zinc-500">{{ formatDateTime(item.at) }}</time>
      </li>
    </ol>
    <button
      v-if="hiddenCount"
      type="button"
      class="mt-3 inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
      :aria-expanded="activityExpanded"
      @click="activityExpanded = !activityExpanded"
    >
      <span aria-hidden="true" class="text-base leading-none">{{ activityExpanded ? '−' : '+' }}</span>
      {{ activityExpanded ? t('topic.hideRemaining') : t('topic.showRemaining', { count: hiddenCount }) }}
    </button>
    <button v-if="items.length < total" type="button" class="mt-4 text-sm font-semibold text-emerald-800 underline" :disabled="pending" @click="loadMore">
      {{ pending ? t('topic.loading') : t('topic.activityMore') }}
    </button>
  </section>
</template>

<script setup>
const props = defineProps({
  slug: { type: String, required: true },
  tick: { type: Number, default: 0 },
})
const { t, locale } = useLocale()
const { public: { nodeDomain } } = useRuntimeConfig()
const encoded = computed(() => encodeURIComponent(props.slug))
const { data, error: fetchError } = await useFetch(() => `/api/topics/${encoded.value}/activity?limit=30&offset=0`)
const items = ref(data.value?.items || [])
const total = ref(data.value?.total || 0)
const activityExpanded = ref(false)
const pending = ref(false)
const loadError = ref('')
const error = computed(() => loadError.value || fetchError.value?.data?.statusMessage || '')
const hiddenCount = computed(() => Math.max(0, items.value.length - 4))
const displayedItems = computed(() => activityExpanded.value ? items.value : items.value.slice(0, 4))

watch(data, (value) => {
  items.value = value?.items || []
  total.value = value?.total || 0
})

watch(() => props.tick, async () => {
  try {
    const next = await $fetch(`/api/topics/${encoded.value}/activity?limit=30&offset=0`)
    items.value = next.items || []
    total.value = next.total || 0
  } catch (requestError) {
    loadError.value = requestError?.data?.statusMessage || t('topic.activityFailed')
  }
})

function shown(person) {
  return person?.displayName || (person?.username ? `${person.username}@${nodeDomain}` : t('topic.activityCommunity'))
}

function sentence(item) {
  const name = shown(item.actor)
  const other = shown(item.other)
  if (item.kind === 'page_created') return t('topic.activityPageCreated', { name })
  if (item.kind === 'revision_published') return t('topic.activityRevision', { name })
  if (item.kind === 'edit_proposed') return t('topic.activityProposed', { name })
  if (item.kind === 'edit_accepted') return t('topic.activityAccepted', { name, other })
  if (item.kind === 'edit_rejected') return t('topic.activityRejected', { name, other })
  if (item.kind === 'transfer_offered') {
    const base = t('topic.activityOffered', { name, other })
    if (item.from?.username && item.from.username !== item.actor?.username) {
      return `${base} ${t('topic.activityOfferedFrom', { from: shown(item.from) })}`
    }
    return base
  }
  if (item.kind === 'transfer_accepted') return t('topic.activityAcceptedTransfer', { name, other })
  if (item.kind === 'transfer_declined') return t('topic.activityDeclinedTransfer', { name, other })
  if (item.kind === 'transfer_cancelled') return t('topic.activityCancelledTransfer', { name, other })
  if (item.kind === 'transfer_withdrawn') return t('topic.activityWithdrawn', { other })
  return name
}

async function loadMore() {
  if (pending.value || items.value.length >= total.value) return
  pending.value = true
  try {
    const next = await $fetch(`/api/topics/${encoded.value}/activity?limit=30&offset=${items.value.length}`)
    items.value.push(...(next.items || []))
    total.value = next.total
  } catch (requestError) {
    loadError.value = requestError?.data?.statusMessage || t('topic.activityFailed')
  } finally {
    pending.value = false
  }
}

function formatDateTime(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''
}
</script>
