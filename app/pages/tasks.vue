<template>
  <section class="mx-auto max-w-5xl">
    <BackLink to="/">{{ t('tasks.home') }}</BackLink>
    <UnifiedTaskQueue />
    <div class="mt-5 flex flex-wrap items-end justify-between gap-4">
      <div><p class="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">AIKI · COMMUNITY</p><h1 class="mt-2 font-serif text-3xl font-normal tracking-tight">{{ t('tasks.title') }}</h1><p class="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{{ t('tasks.description') }}</p></div>
      <UButton color="neutral" variant="outline" @click="loadTasks">{{ t('tasks.refresh') }}</UButton>
    </div>
    <p v-if="notice" class="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950" role="status">{{ notice }}</p>
    <p v-if="error" class="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">{{ t('tasks.loadFailed') }}</p>
    <div v-if="pending" class="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-500" role="status">{{ t('topics.loading') }}</div>
    <div v-else-if="!tasks.length" class="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-zinc-600">{{ t('tasks.empty') }}</div>
    <div v-else class="mt-6 space-y-4">
      <article v-for="task in taskItems" :key="task.id" class="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2"><span class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900">{{ statusLabel(task.status) }}</span><span v-if="task.taskType === 'overview'" class="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-900">{{ t('tasks.overviewType') }}</span><span class="text-xs text-zinc-400">{{ task.locale }} · {{ formatDate(task.createdAt) }}</span></div>
          <code class="text-xs text-zinc-400">{{ task.id }}</code>
        </div>
          <h2 class="mt-4 font-serif text-xl font-normal"><NuxtLink :to="`/a/${encodeURIComponent(task.id)}`" class="text-zinc-900 hover:text-emerald-800 hover:underline">{{ task.query }}</NuxtLink></h2>
        <p v-if="task.taskType === 'overview'" class="mt-2 text-sm text-zinc-600">{{ t('tasks.overviewTask') }} <NuxtLink v-if="task.target?.path" :to="task.target.path" class="font-semibold text-emerald-800 underline">{{ task.target.title || task.query }}</NuxtLink></p>
        <div v-if="task.publishedResult" class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-semibold text-zinc-900">{{ task.publishedResult.title }}</h3><span class="text-xs text-zinc-600">{{ kindLabel(task.publishedResult.kind) }} · {{ t('tasks.aiWriter') }}</span></div>
          <p class="mt-3 whitespace-pre-line text-sm leading-6 text-zinc-700">{{ task.publishedResult.body }}</p>
          <div v-if="task.publishedResult.sources?.length" class="mt-4 border-t border-emerald-200 pt-3"><h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-600">{{ t('tasks.sources') }}</h4><ul class="mt-2 space-y-1 text-sm"><li v-for="source in task.publishedResult.sources" :key="source.url"><a :href="source.url" rel="noopener noreferrer" target="_blank" class="break-all text-emerald-800 underline">{{ source.title || source.url }}</a><span v-if="source.publisher" class="text-zinc-500"> · {{ source.publisher }}</span></li></ul></div>
        </div>
        <div v-else-if="task.submission" class="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-semibold text-zinc-900">{{ task.taskType === 'overview' ? t('tasks.proposedOverview') : task.submission.title }}</h3><span class="text-xs text-zinc-500">{{ task.taskType === 'overview' ? t('tasks.communityProposal') : kindLabel(task.submission.kind) }} · {{ task.submission.submittedBy || t('tasks.aiWriter') }}</span></div>
          <p v-if="task.taskType === 'overview'" class="mt-3 whitespace-pre-line text-sm leading-6 text-zinc-700">{{ task.submission.overview }}</p>
          <p v-else class="mt-3 whitespace-pre-line text-sm leading-6 text-zinc-700">{{ task.submission.body }}</p>
          <div v-if="task.submission.sources?.length" class="mt-4 border-t border-zinc-200 pt-3"><h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('tasks.sources') }}</h4><ul class="mt-2 space-y-1 text-sm"><li v-for="source in task.submission.sources" :key="source.url"><a :href="source.url" rel="noopener noreferrer" target="_blank" class="break-all text-emerald-800 underline">{{ source.title || source.url }}</a><span v-if="source.publisher" class="text-zinc-500"> · {{ source.publisher }}</span></li></ul></div>
          <div v-if="canReview && task.taskType !== 'overview' && task.status === 'submitted'" class="mt-4 grid gap-3 border-t border-zinc-200 pt-4">
            <label class="grid gap-1 text-sm font-medium text-zinc-700">{{ t('tasks.reviewComment') }}<textarea v-model="reviewComments[task.id]" rows="2" maxlength="2000" class="rounded-lg border border-zinc-300 bg-white p-3 font-normal" :placeholder="t('tasks.reviewCommentHint')"></textarea></label>
            <div class="flex flex-wrap gap-2"><UButton color="primary" :disabled="busyTask === task.id" @click="reviewTask(task, 'accepted')">{{ t('tasks.accept') }}</UButton><UButton color="neutral" variant="outline" :disabled="busyTask === task.id" @click="reviewTask(task, 'rejected')">{{ t('tasks.reject') }}</UButton></div>
          </div>
        </div>
        <div v-if="task.agentRun" class="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950" role="status">
          <div class="flex flex-wrap items-center justify-between gap-2"><span>{{ agentRunStatus(task.agentRun.status) }}</span><span v-if="task.agentRun.status !== 'failed'" data-testid="agent-progress" class="font-mono text-xs">{{ agentProgress(task.agentRun) }}</span></div>
          <div v-if="task.agentRun.status !== 'completed' && task.agentRun.status !== 'failed'" class="mt-2 h-1.5 overflow-hidden rounded-full bg-indigo-100"><div class="h-full rounded-full bg-indigo-600 transition-all" :style="{ width: `${task.agentRun.progressPercent || 0}%` }"></div></div>
          <p v-if="task.agentRun.providerCost !== null && task.agentRun.providerCost !== undefined" class="mt-2 text-xs text-indigo-800">{{ t('tasks.agentCost') }}: {{ formatAgentCost(task.agentRun.providerCost) }}</p>
          <p v-if="task.agentRun.status === 'failed'" class="mt-2 text-sm text-red-800">{{ agentError(task.agentRun) }}</p>
          <span v-if="task.agentRun.refunded"> {{ t('tasks.agentRefunded') }}</span><NuxtLink v-if="task.agentRun.status === 'completed' && task.publishedPath" :to="task.publishedPath" class="ml-2 font-semibold underline">{{ t('tasks.agentPublishedLink') }}</NuxtLink>
        </div>
        <div v-if="!actor" class="mt-5 text-sm text-zinc-600"><NuxtLink to="/login" class="font-semibold text-emerald-800 underline">{{ t('tasks.signIn') }}</NuxtLink>{{ t('tasks.signInToWork') }}</div>
        <div v-else-if="['open', 'claimed'].includes(task.status)" class="mt-5">
          <div v-if="task.automationRunning" class="space-y-4"><p class="text-sm text-indigo-900">{{ t('tasks.agentRunning') }}</p></div>
          <div v-else-if="claimByMe(task)" class="space-y-4">
            <p class="text-sm text-emerald-800">{{ t('tasks.claimedByMe') }}</p>
            <div v-if="task.taskType !== 'overview'" class="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
              <p class="text-sm text-indigo-950">{{ t('tasks.agentDescription') }}</p>
              <label class="mt-3 flex items-start gap-2 text-sm text-indigo-950"><input v-model="agentConsent[task.id]" type="checkbox" class="mt-1 accent-indigo-700"><span>{{ t('tasks.agentConsent') }}</span></label>
              <UButton class="mt-3" color="primary" :disabled="busyTask === task.id || !agentConsent[task.id]" @click="runNeronAgent(task)">{{ busyTask === task.id ? t('tasks.agentStarting') : t('tasks.runAgent') }}</UButton>
              <p class="mt-2 text-xs text-indigo-800">{{ t('tasks.agentPrice') }}</p>
            </div>
            <template v-if="task.taskType === 'overview'">
              <label class="grid gap-1 text-sm font-medium text-zinc-700">{{ t('tasks.overviewLabel') }}<textarea v-model="drafts[task.id].overview" rows="5" minlength="20" maxlength="2000" class="rounded-lg border border-zinc-300 bg-white p-3 font-normal" :placeholder="t('tasks.overviewHint')"></textarea></label>
              <label class="grid gap-1 text-sm font-medium text-zinc-700">{{ t('tasks.overviewRationale') }}<textarea v-model="drafts[task.id].rationale" rows="3" minlength="8" maxlength="2000" class="rounded-lg border border-zinc-300 bg-white p-3 font-normal" :placeholder="t('tasks.overviewRationaleHint')"></textarea></label>
              <div class="flex flex-wrap gap-2"><UButton color="primary" :disabled="busyTask === task.id" @click="submitDraft(task)">{{ t('tasks.submitOverview') }}</UButton><UButton color="neutral" variant="outline" :disabled="busyTask === task.id" @click="releaseTask(task)">{{ t('tasks.release') }}</UButton></div>
            </template>
            <template v-else-if="task.agentRun?.status !== 'completed'">
            <label class="grid gap-1 text-sm font-medium text-zinc-700">{{ t('tasks.titleLabel') }}<input v-model="drafts[task.id].title" maxlength="180" class="rounded-lg border border-zinc-300 bg-white p-3 font-normal"></label>
            <label class="grid gap-1 text-sm font-medium text-zinc-700">{{ t('tasks.kindLabel') }}<select v-model="drafts[task.id].kind" class="rounded-lg border border-zinc-300 bg-white p-3 font-normal"><option value="article">{{ t('topics.articles') }}</option><option value="question">{{ t('topics.questions') }}</option><option value="discussion">{{ t('topics.discussions') }}</option></select></label>
            <label class="grid gap-1 text-sm font-medium text-zinc-700">{{ t('tasks.bodyLabel') }}<textarea v-model="drafts[task.id].body" rows="8" maxlength="40000" class="rounded-lg border border-zinc-300 bg-white p-3 font-normal"></textarea></label>
            <template v-if="drafts[task.id].kind === 'article'">
              <label class="grid gap-1 text-sm font-medium text-zinc-700">{{ t('tasks.sourcesLabel') }}<textarea v-model="drafts[task.id].sourceLines" rows="3" class="rounded-lg border border-zinc-300 bg-white p-3 font-mono text-xs font-normal" :placeholder="t('tasks.sourceLinesHint')"></textarea></label>
              <label class="grid gap-1 text-sm font-medium text-zinc-700">{{ t('tasks.authorshipLabel') }}<select v-model="drafts[task.id].authorshipMode" class="rounded-lg border border-zinc-300 bg-white p-3 font-normal"><option value="ai_generated_unreviewed">{{ t('topic.authorshipAIUnreviewed') }}</option><option value="ai_generated_human_reviewed">{{ t('topic.authorshipAIReviewed') }}</option></select></label>
              <label class="grid gap-1 text-sm font-medium text-zinc-700">{{ t('tasks.modelLabel') }}<input v-model="drafts[task.id].modelName" maxlength="160" class="rounded-lg border border-zinc-300 bg-white p-3 font-normal"></label>
            </template>
            <div class="flex flex-wrap gap-2"><UButton color="primary" :disabled="busyTask === task.id" @click="submitDraft(task)">{{ t('tasks.submit') }}</UButton><UButton color="neutral" variant="outline" :disabled="busyTask === task.id" @click="releaseTask(task)">{{ t('tasks.release') }}</UButton></div>
            </template>
          </div>
          <div v-else class="flex flex-wrap items-center justify-between gap-3"><div><p class="text-sm text-zinc-600">{{ task.status === 'claimed' ? t('tasks.claimedOther') : t('tasks.open') }}</p><p v-if="task.status === 'claimed' && task.claimActor" class="mt-1 text-xs text-zinc-500">{{ t('tasks.claimant', { name: task.claimActor, time: formatDate(task.claimExpiresAt) }) }}</p></div><UButton color="primary" :disabled="busyTask === task.id" @click="claimTask(task)">{{ t(task.status === 'claimed' ? 'tasks.takeOver' : 'tasks.claim') }}</UButton></div>
        </div>
        <p v-else-if="task.status === 'submitted'" class="mt-4 text-sm text-amber-800">{{ task.taskType === 'overview' ? t('tasks.overviewAwaitingReview') : t('tasks.awaitingReview') }}</p>
        <p v-else-if="task.agentRun?.status === 'completed'" class="mt-4 text-sm text-emerald-800">{{ t('tasks.agentReady') }}</p>
      </article>
    </div>
  </section>
</template>

<script setup>
const { t, locale } = useLocale()
const route = useRoute()
const { data: authState } = await useFetch('/api/auth/me')
const actor = computed(() => authState.value?.actor || null)
const canReview = computed(() => ['owner', 'admin', 'moderator'].includes(actor.value?.role))
const { data, pending, error, refresh: loadTasks } = await useFetch('/api/writing-tasks', { default: () => ({ items: [] }) })
let runPollTimer
onMounted(() => { runPollTimer = setInterval(() => { if (data.value?.items?.some(task => ['queued', 'submitted'].includes(task.agentRun?.status) || task.automationRunning)) void loadTasks() }, 5000) })
onBeforeUnmount(() => clearInterval(runPollTimer))
const requestedTaskId = computed(() => typeof route.query.task === "string" ? route.query.task : "")
const tasks = computed(() => {
  const items = data.value?.items || []
  if (!requestedTaskId.value) return items
  return [...items].sort((a, b) => Number(b.id === requestedTaskId.value) - Number(a.id === requestedTaskId.value))
})
const runStates = reactive({})
const taskItems = computed(() => tasks.value.map(task => ({ ...task, agentRun: task.agentRun || runStates[task.id] || null })))
watch(tasks, (items) => { for (const task of items) if (task.agentRun) runStates[task.id] = task.agentRun }, { immediate: true })
function agentRunStatus(status) { return t(({ queued: 'tasks.agentQueued', submitted: 'tasks.agentRunning', completed: 'tasks.agentReady', failed: 'tasks.agentFailed' })[status] || 'tasks.agentQueued') }
function agentProgress(run) { return `${Math.max(0, Math.min(100, Number(run?.progressPercent || 0)))}%` }
function formatAgentCost(cost) {
  if (cost === null || cost === undefined) return ''
  if (typeof cost !== 'object') return String(cost)
  const amount = cost.amount ?? cost.value ?? cost.total ?? cost.cost ?? cost.price ?? cost.credits
  const unit = cost.currency ?? cost.unit ?? cost.units ?? ''
  if (amount !== undefined) return `${amount}${unit ? ` ${unit}` : ''}`
  return Object.entries(cost).slice(0, 4).map(([key, value]) => `${key}=${value}`).join(', ')
}
function agentError(run) { return run?.progressMessage || t(({ budget_unavailable: 'tasks.agentErrorBudget', executor_configuration: 'tasks.agentErrorConfiguration', executor_unavailable: 'tasks.agentErrorUnavailable', executor_timeout: 'tasks.agentErrorTimeout', executor_busy: 'tasks.agentErrorBusy' })[run?.error] || 'tasks.agentErrorUnavailable') }
const notice = ref('')
const busyTask = ref('')
const drafts = reactive({})
const reviewComments = reactive({})
const agentConsent = reactive({})
watch(tasks, (items) => {
  for (const task of items) {
    if (!drafts[task.id]) drafts[task.id] = makeDraft(task)
  }
}, { immediate: true })

function makeDraft(task) {
  if (task.taskType === 'overview') return { overview: task.submission?.overview || '', rationale: '' }
  const title = task.submission?.title || task.query.slice(0, 180)
  const body = task.submission?.body || `${task.query}\n\n${t('tasks.draftIntro')}`
  const sources = task.submission?.sources || []
  return { title: title.length >= 8 ? title : `${title} article`, kind: task.submission?.kind || 'article', body, sourceLines: sources.map(source => [source.url, source.title, source.publisher, source.locator, source.note].join('|')).join('\n'), authorshipMode: task.submission?.authorshipMode || 'ai_generated_unreviewed', modelName: task.submission?.modelName || 'Neron Agent' }
}
function claimByMe(task) { return Boolean(actor.value && task.claimedBy === actor.value.id) }
function statusLabel(status) { return t(({ open: 'tasks.statusOpen', claimed: 'tasks.statusClaimed', submitted: 'tasks.statusSubmitted', accepted: 'tasks.statusAccepted' })[status] || 'tasks.statusOpen') }
function kindLabel(kind) { return t(({ article: 'topics.articles', question: 'topics.questions', discussion: 'topics.discussions' })[kind] || 'topics.title') }
function formatDate(value) { return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(value)) : '' }
async function perform(task, action) {
  busyTask.value = task.id
  notice.value = ''
  try { await action(); await loadTasks() } catch (requestError) { notice.value = requestError?.data?.statusMessage || requestError?.statusMessage || t('tasks.actionFailed') }
  finally { busyTask.value = '' }
}
function runNeronAgent(task) {
  return perform(task, async () => {
    if (!agentConsent[task.id]) throw new Error(t('tasks.agentConsent'))
    const keyName = `aiki-agent-run:${task.id}`
    let idempotencyKey = localStorage.getItem(keyName)
    if (!idempotencyKey) {
      idempotencyKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(keyName, idempotencyKey)
    }
    const result = await $fetch(`/api/writing-tasks/${task.id}/agent-run`, { method: 'POST', body: { idempotencyKey, consent: true } })
    agentConsent[task.id] = false
    runStates[task.id] = { ...(result.run || {}), status: result.run?.status || 'queued', refunded: Boolean(result.run?.refunded) }
    notice.value = t('tasks.agentAccepted')
  })
}
function claimTask(task) { return perform(task, async () => { await $fetch(`/api/writing-tasks/${task.id}/claim`, { method: 'POST', body: { action: 'claim' } }); notice.value = t('tasks.claimedNotice') }) }
function releaseTask(task) { return perform(task, async () => { await $fetch(`/api/writing-tasks/${task.id}/claim`, { method: 'POST', body: { action: 'release' } }); notice.value = t('tasks.releasedNotice') }) }
function parseSources(text) {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => { const [url, title = '', publisher = '', locator = '', note = ''] = line.split('|'); return { url: url.trim(), title: title.trim(), publisher: publisher.trim(), locator: locator.trim(), note: note.trim() } })
}
function submitDraft(task) { return perform(task, async () => { const draft = drafts[task.id]; const body = task.taskType === 'overview' ? { overview: draft.overview, locale: task.locale, rationale: draft.rationale } : { kind: draft.kind, title: draft.title, body: draft.body, locale: task.locale, sources: draft.kind === 'article' ? parseSources(draft.sourceLines) : [], ...(draft.kind === 'article' ? { authorshipMode: draft.authorshipMode, modelName: draft.modelName } : {}) }; await $fetch(`/api/writing-tasks/${task.id}/submissions`, { method: 'POST', body }); notice.value = task.taskType === 'overview' ? t('tasks.overviewSubmittedNotice') : t('tasks.submittedNotice') }) }
function reviewTask(task, decision) { return perform(task, async () => { const comment = reviewComments[task.id] || ''; const result = await $fetch(`/api/writing-tasks/${task.id}/review`, { method: 'PATCH', body: { decision, comment } }); notice.value = decision === 'accepted' && result.topic?.path ? `${t('tasks.acceptedNotice')} ${result.topic.path}` : t('tasks.rejectedNotice') }) }
useSeoMeta({ title: () => `${t('tasks.title')} · AIKI`, description: () => t('tasks.description') })
</script>
