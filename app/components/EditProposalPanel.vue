<template>
  <section v-if="!formOnly" class="mt-12 border-t border-zinc-200 pt-8">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="border-b border-zinc-200 pb-2 font-serif text-2xl font-normal text-zinc-950">{{ t('topic.proposals') }}</h2>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{{ t('topic.proposalsDescription') }}</p>
      </div>
      <span class="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">{{ t('topic.reviewPending') }}</span>
    </div>
    <p v-if="reviewSummary" role="status" class="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{{ reviewSummary }}</p>
    <p v-if="!proposals.length" class="mt-5 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-500">{{ t('topic.noProposals') }}</p>
    <ol v-else class="mt-5 space-y-4">
      <li v-for="proposal in proposals" :key="proposal.id" class="rounded-xl border border-zinc-200 p-4 sm:p-5">
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <span class="font-semibold text-emerald-900">{{ proposal.author_display_name || `${proposal.author || 'community'}@${nodeDomain}` }}</span>
          <span v-if="proposal.author_model" data-testid="proposal-model">· {{ proposal.author_model }}</span>
          <span data-testid="proposal-score">{{ t('topic.proposalScore', { count: formatCount(proposal.score || 0) }) }}</span>
          <time :datetime="proposal.created_at">{{ formatDateTime(proposal.created_at) }}</time>
        </div>
        <div v-if="actor" class="mt-3 flex items-center gap-1" data-testid="proposal-vote-controls">
          <button type="button" class="grid size-8 place-items-center rounded-md text-zinc-400 transition hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" :class="proposal.my_vote === 1 ? 'bg-emerald-50 text-emerald-700' : ''" :aria-pressed="proposal.my_vote === 1" :aria-label="t('topic.upvote')" :title="t('topic.upvote')" data-testid="proposal-upvote" @click="vote(proposal, 1)">
            <UIcon name="i-lucide-arrow-big-up" class="size-5" aria-hidden="true" />
          </button>
          <button type="button" class="grid size-8 place-items-center rounded-md text-zinc-400 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" :class="proposal.my_vote === -1 ? 'bg-rose-50 text-rose-700' : ''" :aria-pressed="proposal.my_vote === -1" :aria-label="t('topic.downvote')" :title="t('topic.downvote')" data-testid="proposal-downvote" @click="vote(proposal, -1)">
            <UIcon name="i-lucide-arrow-big-down" class="size-5" aria-hidden="true" />
          </button>
        </div>
        <div v-if="actor && actor.id === topic.author_id" class="mt-3 rounded-lg bg-zinc-50 p-3">
          <p class="text-sm leading-6 text-zinc-600">{{ t('topic.proposalStanceNote') }}</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button" data-testid="proposal-agree" class="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm" :aria-pressed="proposal.author_stance === 'agree'" @click="stance(proposal, 'agree')">{{ t('topic.proposalAgree') }}</button>
            <button type="button" data-testid="proposal-disagree" class="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm" :aria-pressed="proposal.author_stance === 'disagree'" @click="stance(proposal, 'disagree')">{{ t('topic.proposalDisagree') }}</button>
          </div>
        </div>
        <h3 v-if="proposal.proposed_title" class="mt-3 font-semibold">{{ proposal.proposed_title }}</h3>
        <div v-if="proposal.proposal_type === 'overview'" class="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-4">
          <p class="text-xs font-semibold uppercase tracking-wide text-violet-900">{{ t('topic.proposedOverview') }}</p>
          <p class="mt-2 whitespace-pre-line text-sm leading-6 text-violet-950">{{ proposal.proposed_summary }}</p>
        </div>
        <div v-else class="prose-aiki mt-3 max-w-none text-sm" v-html="proposal.html"></div>
        <p class="mt-3 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600"><strong>{{ t('topic.rationale') }}:</strong> {{ proposal.rationale }}</p>

        <details v-if="proposal.proposal_type !== 'overview'" class="mt-4 rounded-lg border border-zinc-200 p-3" @toggle="loadDiff(proposal, $event)">
          <summary class="cursor-pointer text-sm font-semibold text-emerald-900">{{ t('topic.viewDiff') }}</summary>
          <p v-if="diffPending[proposal.id]" class="mt-3 text-sm text-zinc-500">{{ t('topic.loadingDiff') }}</p>
          <p v-else-if="diffErrors[proposal.id]" role="alert" class="mt-3 text-sm text-red-800">{{ diffErrors[proposal.id] }}</p>
          <div v-else-if="diffs[proposal.id]" class="mt-3">
            <p v-if="diffs[proposal.id].title.changed" class="mb-3 rounded bg-zinc-50 p-2 text-sm">
              <span class="text-red-800">− {{ diffs[proposal.id].title.before }}</span>
              <span class="mx-2 text-zinc-400">→</span>
              <span class="text-emerald-800">+ {{ diffs[proposal.id].title.after }}</span>
            </p>
            <p v-if="diffs[proposal.id].body.truncated" class="mb-2 text-sm text-amber-800">{{ t('topic.diffTooLarge') }}</p>
            <pre v-if="diffs[proposal.id].body.lines.length" class="max-h-96 overflow-auto rounded-lg bg-zinc-950 p-4 text-xs leading-6 text-zinc-100"><code><span v-for="(line, index) in diffs[proposal.id].body.lines" :key="index" class="block whitespace-pre-wrap break-words" :class="diffLineClass(line.type)">{{ diffPrefix(line.type) }}{{ line.text }}</span></code></pre>
            <p v-else-if="!diffs[proposal.id].body.truncated" class="text-sm text-zinc-500">{{ t('topic.noBodyChanges') }}</p>
          </div>
        </details>

        <form v-if="canReview(proposal)" class="mt-5 overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white shadow-sm dark:border-emerald-800/70 dark:from-emerald-950/40 dark:to-zinc-900" :aria-busy="reviewPending[proposal.id]" @submit.prevent="review(proposal, 'accept')">
          <div class="flex items-start gap-3 border-b border-emerald-100 px-4 py-3.5 dark:border-emerald-900/70 sm:px-5">
            <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
              <UIcon name="i-lucide-clipboard-check" class="size-5" aria-hidden="true" />
            </span>
            <div>
              <p class="text-sm font-semibold text-emerald-950 dark:text-emerald-100">{{ t('topic.reviewComment') }}</p>
              <p class="mt-1 text-xs leading-5 text-emerald-900/75 dark:text-emerald-200/75">{{ t('tasks.reviewCommentHint') }}</p>
            </div>
          </div>
          <div class="p-4 sm:p-5">
            <label class="grid gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
              <span class="sr-only">{{ t('topic.reviewComment') }}</span>
              <textarea v-model="reviewComments[proposal.id]" required minlength="8" maxlength="2000" rows="4" :aria-describedby="`review-comment-hint-${proposal.id}`" class="min-h-28 w-full resize-y rounded-xl border border-zinc-300 bg-white px-3.5 py-3 leading-6 text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100 dark:border-zinc-600 dark:bg-zinc-950/70 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-emerald-400 dark:focus:ring-emerald-900/60" />
              <span :id="`review-comment-hint-${proposal.id}`" class="text-xs font-normal text-zinc-500 dark:text-zinc-400">{{ t('tasks.reviewCommentHint') }}</span>
            </label>
            <p v-if="reviewErrors[proposal.id]" role="alert" class="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm leading-6 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200">{{ reviewErrors[proposal.id] }}</p>
            <p v-if="reviewNotices[proposal.id]" role="status" class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm leading-6 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">{{ reviewNotices[proposal.id] }}</p>
            <div class="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <UButton type="button" color="error" variant="soft" class="w-full justify-center sm:w-auto" :loading="reviewPending[proposal.id]" :disabled="reviewPending[proposal.id]" @click="review(proposal, 'reject')">{{ t('topic.rejectProposal') }}</UButton>
              <UButton type="submit" color="primary" class="w-full justify-center sm:w-auto" :loading="reviewPending[proposal.id]" :disabled="reviewPending[proposal.id]">{{ t('topic.acceptProposal') }}</UButton>
            </div>
          </div>
        </form>
        <p v-else-if="actor && proposal.author_id === actor.id" class="mt-4 text-xs text-zinc-500">{{ t('topic.cannotReviewOwn') }}</p>
      </li>
    </ol>
    <div v-if="!actor" class="mt-6 border-t border-zinc-200 pt-5 text-sm text-emerald-900"><NuxtLink to="/login" class="font-semibold underline">{{ t('topics.signUpToStart') }}</NuxtLink>{{ t('topic.joinToPropose') }}</div>
  </section>
  <div v-if="actor && !overviewOnly" :class="formOnly ? '' : 'mt-6 border-t border-zinc-200 pt-6'">
    <h2 v-if="formOnly" class="font-serif text-2xl font-normal text-zinc-950">{{ t('topic.proposeEdit') }}</h2>
    <p class="mt-1 text-xs text-zinc-500">{{ t('topic.baseRevision', { revision: topic.revision_id.slice(0, 8) }) }}</p>
    <form class="mt-4" @submit.prevent="submit">
      <label class="block text-sm text-zinc-700">{{ t('topic.proposedTitle') }}
        <input v-model="proposedTitle" maxlength="180" class="mt-1.5 w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100">
      </label>
      <label class="mt-4 block text-sm text-zinc-700">{{ t('topic.proposedBody') }}
        <textarea ref="proposalBodyInput" v-model="proposedBody" required minlength="20" maxlength="40000" rows="10" class="mt-1.5 w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" />
      </label>
      <label class="mt-4 block text-sm text-zinc-700">{{ t('topic.rationaleQuestion') }}
        <textarea v-model="rationale" required minlength="8" maxlength="2000" rows="3" class="mt-1.5 w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" />
      </label>
      <p v-if="notice" role="status" class="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{{ notice }}</p>
      <p v-if="errorMessage" role="alert" class="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{{ errorMessage }}</p>
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span class="text-xs text-zinc-500">{{ t('topic.proposingAs', { name: actor.displayName || `${actor.username}@${nodeDomain}` }) }}</span>
        <UButton type="submit" color="primary" :loading="pending" :disabled="pending">{{ t('topic.submitProposal') }}</UButton>
      </div>
    </form>
  </div>
</template>

<script setup>
import { formatCount } from '~/utils/number-format.js'

const props = defineProps({
  topic: { type: Object, required: true },
  actor: { type: Object, default: null },
  formOnly: { type: Boolean, default: false },
  overviewOnly: { type: Boolean, default: false },
  initialTitle: { type: String, default: '' },
  initialBody: { type: String, default: '' },
  initialSelection: { type: String, default: '' },
  initialRationale: { type: String, default: '' },
})
const emit = defineEmits(['submitted'])
const { t, locale } = useLocale()
const { public: { nodeDomain } } = useRuntimeConfig()
const { data, refresh } = await useFetch(() => `/api/topics/${encodeURIComponent(String(props.topic.slug || ''))}/proposals?status=open`)
const proposals = computed(() => data.value?.items || [])
const proposedTitle = ref(props.initialTitle)
const proposedBody = ref(props.initialBody)
const rationale = ref(props.initialRationale)
const pending = ref(false)
const notice = ref('')
const errorMessage = ref('')
const diffs = reactive({})
const diffPending = reactive({})
const diffErrors = reactive({})
const reviewComments = reactive({})
const reviewPending = reactive({})
const reviewErrors = reactive({})
const reviewNotices = reactive({})
const reviewSummary = ref('')
const canReviewRole = computed(() => props.actor && ['owner', 'admin', 'moderator'].includes(props.actor.role))
const proposalBodyInput = ref(null)

watch(() => [props.initialTitle, props.initialBody, props.initialSelection, props.initialRationale], ([title, body, selection, initialRationale]) => {
  if (props.formOnly) {
    proposedTitle.value = title || ''
    proposedBody.value = body || ''
    rationale.value = initialRationale || ''
    void focusSelectedText()
  }
}, { immediate: true })

onMounted(() => {
  if (props.formOnly) void focusSelectedText()
})

async function focusSelectedText() {
  await nextTick()
  const input = proposalBodyInput.value
  if (!input || !props.initialSelection) return
  const source = String(props.initialBody || '')
  const selected = String(props.initialSelection || '')
  const exactStart = source.indexOf(selected)
  const range = exactStart >= 0 ? { start: exactStart, end: exactStart + selected.length } : findSelectionRange(source, selected)
  if (!range) return
  input.focus()
  input.setSelectionRange(range.start, range.end)
}

function findSelectionRange(source, selected) {
  const target = selected.replace(/\s+/g, ' ').trim()
  if (!target) return null
  let normalized = ''
  const positions = []
  let previousWasSpace = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (/\s/.test(character)) {
      if (previousWasSpace) continue
      normalized += ' '
      positions.push(index)
      previousWasSpace = true
      continue
    }
    normalized += character
    positions.push(index)
    previousWasSpace = false
  }
  const start = normalized.indexOf(target)
  if (start < 0) return null
  const endIndex = start + target.length - 1
  return { start: positions[start], end: positions[endIndex] + 1 }
}

async function loadDiff(proposal, event) {
  if (!event.target.open || diffs[proposal.id] || diffPending[proposal.id]) return
  diffPending[proposal.id] = true
  diffErrors[proposal.id] = ''
  try {
    diffs[proposal.id] = await $fetch(`/api/topics/${encodeURIComponent(String(props.topic.slug || ''))}/proposals/${proposal.id}/diff`)
  } catch (error) {
    diffErrors[proposal.id] = error?.data?.statusMessage || t('topic.diffFailed')
  } finally {
    diffPending[proposal.id] = false
  }
}

async function vote(proposal, direction) {
  const next = proposal.my_vote === direction ? 0 : direction
  try {
    const result = await $fetch(`/api/topics/${encodeURIComponent(String(props.topic.slug || ''))}/proposals/${proposal.id}/votes`, {
      method: 'POST',
      body: { value: next },
    })
    proposal.upvotes = result.vote.upvotes
    proposal.downvotes = result.vote.downvotes
    proposal.score = result.vote.score
    proposal.my_vote = result.vote.my_vote
  } catch (error) {
    reviewErrors[proposal.id] = error?.data?.statusMessage || t('topic.voteFailed')
  }
}

async function stance(proposal, choice) {
  try {
    const result = await $fetch(`/api/topics/${encodeURIComponent(String(props.topic.slug || ''))}/proposals/${proposal.id}/stance`, {
      method: 'POST',
      body: { stance: choice },
    })
    proposal.author_stance = result.author_stance
    reviewSummary.value = t('topic.proposalStanceSaved')
  } catch (error) {
    reviewErrors[proposal.id] = error?.data?.statusMessage || t('topic.reviewFailed')
  }
}

async function review(proposal, action) {
  reviewPending[proposal.id] = true
  reviewErrors[proposal.id] = ''
  reviewNotices[proposal.id] = ''
  try {
    await $fetch(`/api/topics/${encodeURIComponent(String(props.topic.slug || ''))}/proposals/${proposal.id}`, {
      method: 'PATCH',
      body: { action, comment: reviewComments[proposal.id] || '' },
    })
    reviewSummary.value = action === 'accept' ? t('topic.proposalAccepted') : t('topic.proposalRejected')
    await refresh()
  } catch (error) {
    reviewErrors[proposal.id] = error?.data?.statusMessage || t('topic.reviewFailed')
  } finally {
    reviewPending[proposal.id] = false
  }
}

async function submit() {
  pending.value = true
  notice.value = ''
  errorMessage.value = ''
  try {
    await $fetch(`/api/topics/${encodeURIComponent(String(props.topic.slug || ''))}/proposals`, {
      method: 'POST',
      body: {
        baseRevisionId: props.topic.revision_id,
        locale: props.topic.locale,
        proposedTitle: proposedTitle.value,
        proposedBody: proposedBody.value,
        rationale: rationale.value,
      },
    })
    proposedTitle.value = ''
    proposedBody.value = ''
    rationale.value = ''
    notice.value = t('topic.proposalSubmitted')
    emit('submitted')
    await refresh()
  } catch (error) {
    errorMessage.value = error?.data?.statusMessage || t('topic.proposalFailed')
  } finally {
    pending.value = false
  }
}

function canReview(proposal) {
  const isTopicAuthor = proposal.proposal_type === 'overview' && props.topic.author_id === props.actor?.id
  const isDifferentAuthor = proposal.proposal_type === 'overview' || proposal.author_id !== props.actor?.id
  return Boolean((canReviewRole.value || isTopicAuthor) && isDifferentAuthor)
}

function diffPrefix(type) {
  return type === 'removed' ? '− ' : type === 'added' ? '+ ' : type === 'gap' ? '' : '  '
}

function diffLineClass(type) {
  return type === 'removed' ? 'bg-red-950 text-red-200' : type === 'added' ? 'bg-emerald-950 text-emerald-200' : type === 'gap' ? 'text-zinc-400' : 'text-zinc-300'
}

function formatDateTime(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''
}
</script>
