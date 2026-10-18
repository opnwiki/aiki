<template>
  <main class="mx-auto max-w-3xl">
    <BackLink to="/">{{ t('order.backHome') }}</BackLink>
    <section class="mt-6 rounded-[1.75rem] border border-zinc-200 bg-white p-6 shadow-sm sm:p-10" aria-labelledby="order-title">
      <div class="flex items-start gap-4">
        <span class="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 via-amber-400 to-emerald-400 text-2xl text-white" aria-hidden="true">✦</span>
        <div class="min-w-0">
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{{ t('order.taskId') }} · {{ orderId }}</p>
          <h1 id="order-title" class="mt-2 break-words font-serif text-3xl text-zinc-950">{{ order?.query || t('order.statusTitle') }}</h1>
          <p class="mt-3 text-sm leading-6 text-zinc-600" role="status" aria-live="polite">{{ statusDescription }}</p>
        </div>
      </div>

      <div v-if="order" class="mt-8 rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-zinc-800">
            <span v-if="order.execution === 'pending' || order.execution === 'submitted' || ['open', 'claimed'].includes(order.writingTaskStatus)" class="size-2 rounded-full bg-amber-500" aria-hidden="true"></span>
            <span v-else-if="order.writingTaskStatus === 'submitted' || order.writingTaskStatus === 'accepted' || order.resultPath" class="size-2 rounded-full bg-emerald-600" aria-hidden="true"></span>
            <span v-else class="size-2 rounded-full bg-zinc-400" aria-hidden="true"></span>
            {{ statusLabel }}
          </span>
          <time v-if="order.updatedAt" class="text-xs text-zinc-500">{{ t('order.updated') }}: {{ formatDate(order.updatedAt) }}</time>
        </div>

        <div v-if="order.execution === 'pending' || order.execution === 'submitted'" class="mt-5">
          <div class="h-2 overflow-hidden rounded-full bg-zinc-200" role="progressbar" :aria-label="statusLabel" aria-valuemin="0" aria-valuemax="100">
            <div class="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-fuchsia-500 via-amber-400 to-emerald-500"></div>
          </div>
          <p class="mt-3 text-sm text-zinc-600">{{ order.execution === 'submitted' ? t('order.runningNote') : t('order.waitingNote') }}</p>
        </div>

        <div v-if="order.writingTaskId" class="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <p>{{ order.error ? t('order.failedStatus') : statusDescription }}</p>
          <p v-if="order.writingTaskStatus" class="mt-1 text-xs text-emerald-800">{{ taskStatusLabel }}</p>
          <NuxtLink :to="`/a/${encodeURIComponent(order.writingTaskId)}`" class="mt-2 inline-flex font-semibold underline">{{ order.writingTaskStatus === 'submitted' ? t('tasks.openTaskList') : t('order.openResult') }} →</NuxtLink>
        </div>
        <NuxtLink v-else-if="order.resultPath" :to="order.resultPath" class="aiki-button mt-5 inline-flex rounded-xl px-5 py-3 text-sm font-semibold">{{ t('order.openResult') }} →</NuxtLink>
        <p v-else-if="order.execution === 'community'" class="mt-4 text-sm text-zinc-600">{{ statusDescription }}</p>
      </div>

      <div v-else-if="loading" class="mt-8 rounded-2xl bg-zinc-50 p-5 text-sm text-zinc-500">{{ t('topics.loading') }}</div>
      <div v-else class="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900" role="alert">{{ t('order.statusUnavailable') }}</div>
      <p class="mt-5 text-xs leading-5 text-zinc-400">{{ t('order.noProgressPromise') }}</p>
    </section>
  </main>
</template>

<script setup>
const route = useRoute()
const { t, locale } = useLocale()
const orderId = computed(() => String(route.params.id || ''))
const order = ref(null)
const loading = ref(true)
let pollTimer
let stopped = false

const statusLabel = computed(() => {
  const key = order.value?.resultPath || order.value?.writingTaskStatus === 'submitted'
    ? 'order.statusSucceeded'
    : order.value?.execution === 'submitted' ? 'order.statusRunning' : 'order.statusQueued'
  return t(key)
})
const statusDescription = computed(() => {
  if (order.value?.resultPath || order.value?.writingTaskStatus === 'submitted') return t('order.succeededDescription')
  if (order.value?.writingTaskId && order.value.error) return t('order.failedStatus')
  if (order.value?.writingTaskId) return t('order.queuedDescription')
  return order.value?.execution === 'submitted' ? t('order.runningDescription') : t('order.queuedDescription')
})

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''
}

async function refreshOrder() {
  if (!import.meta.client || stopped) return
  const accessToken = sessionStorage.getItem(`aiki-article-order:${orderId.value}`)
  if (!accessToken) {
    loading.value = false
    order.value = null
    return
  }
  try {
    const result = await $fetch(`/api/article-orders/${encodeURIComponent(orderId.value)}`, { headers: { authorization: `Bearer ${accessToken}` } })
    order.value = result.order
  } catch {
    order.value = null
  } finally {
    loading.value = false
    if (!stopped && order.value?.execution !== 'draft_ready') pollTimer = setTimeout(refreshOrder, 5000)
  }
}

onMounted(refreshOrder)
onUnmounted(() => {
  stopped = true
  clearTimeout(pollTimer)
})

useSeoMeta({
  title: () => `${t('order.statusTitle')} — AIKI`,
  robots: 'noindex, nofollow',
})
</script>
