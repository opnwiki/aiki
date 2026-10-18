<template>
  <section v-if="items.length || summary" id="pending-task-solutions" class="mt-8 scroll-mt-24 rounded-[1.75rem] border border-amber-200 bg-amber-50/40 p-6 shadow-sm sm:p-8" data-testid="pending-task-solutions">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-serif text-2xl font-normal text-zinc-950">{{ t('topic.pendingSolutions') }}</h2>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{{ t('topic.pendingSolutionsDescription') }}</p>
      </div>
      <span class="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">{{ formatCount(items.length) }}</span>
    </div>
    <p v-if="summary" role="status" class="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{{ summary }}</p>
    <ol class="mt-5 space-y-4">
      <li v-for="item in items" :key="item.id" class="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span class="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">{{ taskTypeLabel(item.taskType) }}</span>
          <span class="font-semibold text-emerald-900">{{ item.submitter?.name || item.submitter?.username || t('topic.pendingSolutionsAnonymous') }}</span>
          <span v-if="item.model || item.client">· {{ item.client || item.model }}</span>
          <time :datetime="item.createdAt">· {{ formatDateTime(item.createdAt) }}</time>
          <span v-if="item.autoAcceptAt">· {{ t('topic.pendingSolutionsAutoAccept', { time: formatDateTime(item.autoAcceptAt) }) }}</span>
        </div>
        <p v-if="item.taskType === 'answer_question'" class="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm leading-6 text-sky-950">{{ t('topic.pendingSolutionsAnswerHint') }}</p>

        <template v-if="item.taskType === 'update_overview'">
          <div v-if="item.base?.summary" class="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('topic.pendingSolutionsCurrentOverview') }}</p>
            <p class="mt-1.5 whitespace-pre-line text-sm leading-6 text-zinc-600">{{ item.base.summary }}</p>
          </div>
          <div class="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
            <p class="text-xs font-semibold uppercase tracking-wide text-violet-900">{{ t('topic.proposedOverview') }}</p>
            <p class="mt-1.5 whitespace-pre-line text-sm leading-6 text-violet-950">{{ item.payload?.summary || item.payload?.overview }}</p>
          </div>
        </template>
        <template v-else>
          <h3 v-if="item.payload?.title" class="mt-3 font-semibold text-zinc-900">{{ item.payload.title }}</h3>
          <p v-if="item.payload?.summary" class="mt-2 whitespace-pre-line rounded-lg bg-violet-50 p-3 text-sm leading-6 text-violet-950">{{ item.payload.summary }}</p>
          <details v-if="item.payload?.body" class="mt-3 rounded-lg border border-zinc-200 p-3">
            <summary class="cursor-pointer text-sm font-semibold text-emerald-900">{{ t('topic.pendingSolutionsShowText') }}</summary>
            <pre class="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-zinc-700">{{ item.payload.body }}</pre>
          </details>
        </template>
        <p v-if="item.payload?.rationale" class="mt-3 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600"><strong>{{ t('topic.rationale') }}:</strong> {{ item.payload.rationale }}</p>

        <div v-if="item.canReview" class="mt-4 flex flex-wrap items-center gap-2">
          <UButton color="primary" :loading="pending[item.id]" :disabled="pending[item.id]" data-testid="task-solution-accept" @click="review(item, 'accept')">{{ item.taskType === 'answer_question' ? t('topic.acceptAnswer') : t('topic.acceptProposal') }}</UButton>
          <UButton color="error" variant="soft" :loading="pending[item.id]" :disabled="pending[item.id]" data-testid="task-solution-reject" @click="review(item, 'reject')">{{ t('topic.rejectProposal') }}</UButton>
        </div>
        <p v-if="errors[item.id]" role="alert" class="mt-3 text-sm text-red-800">{{ errors[item.id] }}</p>
      </li>
    </ol>
  </section>
</template>

<script setup>
import { formatCount } from '~/utils/number-format.js'

const props = defineProps({
  slug: { type: String, required: true },
})
const emit = defineEmits(['accepted'])
const { t, locale } = useLocale()
const { data, refresh } = await useFetch(() => `/api/topics/${encodeURIComponent(props.slug)}/task-solutions`)
const items = computed(() => data.value?.items || [])
const pending = reactive({})
const errors = reactive({})
const summary = ref('')

function taskTypeLabel(type) {
  return t(`topic.taskType.${type}`)
}

async function review(item, action) {
  pending[item.id] = true
  errors[item.id] = ''
  try {
    await $fetch(`/api/tasks/${item.taskId}/review`, {
      method: 'PATCH',
      body: { action, solutionId: item.id, comment: action === 'accept' ? (item.taskType === 'answer_question' ? t('topic.pendingSolutionsAnswerAcceptedComment') : t('topic.pendingSolutionsAcceptedComment')) : t('topic.pendingSolutionsRejectedComment') },
    })
    summary.value = action === 'accept'
      ? (item.taskType === 'answer_question' ? t('topic.answerAccepted') : t('topic.proposalAccepted'))
      : t('topic.proposalRejected')
    await refresh()
    if (action === 'accept') emit('accepted')
  } catch (error) {
    errors[item.id] = error?.data?.statusMessage || t('topic.reviewFailed')
  } finally {
    pending[item.id] = false
  }
}

function formatDateTime(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''
}
</script>
