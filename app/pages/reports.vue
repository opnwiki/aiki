<template>
  <section class="mx-auto max-w-3xl space-y-6">
    <BackLink to="/account">{{ t('reports.back') }}</BackLink>
    <div>
      <h1 class="mt-6 font-serif text-3xl font-normal tracking-tight text-zinc-950">{{ t('reports.title') }}</h1>
      <p class="mt-3 leading-7 text-zinc-600">{{ t('reports.description') }}</p>
    </div>

    <p v-if="pending" role="status" class="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">{{ t('topics.loading') }}</p>
    <p v-else-if="statusCode === 401" role="alert" class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      <NuxtLink to="/login" class="font-semibold underline">{{ t('nav.signIn') }}</NuxtLink>
      <span> — {{ t('reports.signIn') }}</span>
    </p>
    <p v-else-if="error" role="alert" class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">{{ t('reports.unavailable') }}</p>
    <p v-else-if="!reports.length" class="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">{{ t('reports.empty') }}</p>
    <ol v-else class="space-y-4">
      <li v-for="report in reports" :key="report.id" class="rounded-2xl border border-zinc-200 bg-white p-5">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <NuxtLink :to="pagePath(report)" class="font-medium text-emerald-800 hover:underline">{{ report.title }}</NuxtLink>
          <time class="text-xs text-zinc-500" :datetime="report.createdAt">{{ formatUtcStamp(report.createdAt) }}</time>
        </div>
        <p class="mt-2 text-sm text-zinc-700">{{ reasonLabel(report.reason) }} · {{ report.reporter || t('reports.anonymous') }}</p>
        <p class="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{{ report.details }}</p>
        <p v-if="actionError[report.id]" role="alert" class="mt-3 text-sm text-red-800">{{ actionError[report.id] }}</p>
        <div class="mt-4 flex justify-end">
          <UButton type="button" color="neutral" variant="outline" size="sm" :loading="notingId === report.id" :disabled="notingId === report.id" @click="noteReport(report.id)">{{ t('reports.note') }}</UButton>
        </div>
      </li>
    </ol>
  </section>
</template>

<script setup>
const { t } = useLocale()
const { data, pending, error, refresh } = await useFetch('/api/page-reports')
const reports = computed(() => data.value?.reports || [])
const statusCode = computed(() => error.value?.statusCode || error.value?.status || null)
const notingId = ref('')
const actionError = reactive({})

function reasonLabel(reason) {
  return t(({
    inaccurate: 'topic.reportReasonInaccurate',
    illegal: 'topic.reportReasonIllegal',
    rights: 'topic.reportReasonRights',
    other: 'topic.reportReasonOther',
  })[reason] || 'topic.reportReasonOther')
}

function formatUtcStamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

async function noteReport(id) {
  notingId.value = id
  actionError[id] = ''
  try {
    await $fetch(`/api/page-reports/${id}`, { method: 'PATCH', body: { status: 'noted' } })
    await refresh()
  } catch (requestError) {
    actionError[id] = requestError?.data?.statusMessage || t('reports.failed')
  } finally {
    notingId.value = ''
  }
}

useSeoMeta({ title: () => `${t('reports.title')} · AIKI`, robots: 'noindex, nofollow' })
</script>
