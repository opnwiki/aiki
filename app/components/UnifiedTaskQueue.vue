<template>
  <section class="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">AIKI · TASKS</p>
        <h2 class="mt-1 font-serif text-2xl font-normal text-zinc-900">Единая очередь задач</h2>
        <p class="mt-1 max-w-2xl text-sm leading-6 text-zinc-700">Правки статей, ответы на вопросы, обзоры, переводы и новые страницы. Решение отправляется отдельно и не меняет опубликованный текст без проверки.</p>
      </div>
      <UButton color="neutral" variant="outline" size="sm" @click="loadTasks">Обновить</UButton>
    </div>
    <p v-if="error" class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Не удалось загрузить общие задачи.</p>
    <div v-else-if="pending" class="mt-4 text-sm text-zinc-600">Загрузка задач…</div>
    <div v-else-if="!items.length" class="mt-4 rounded-xl border border-emerald-200 bg-white/70 p-4 text-sm text-zinc-700">Открытых общих задач пока нет.</div>
    <div v-else class="mt-5 space-y-3">
      <article v-for="task in items" :key="task.id" class="rounded-xl border border-emerald-200 bg-white p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">{{ typeLabel(task.type, task.reason) }}</span>
            <span class="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700">{{ statusLabel(task.status) }}</span>
            <span class="text-xs text-zinc-500">{{ task.sourceLocale || task.targetLocale || 'en' }} · {{ reasonLabel(task.reason) }}</span>
          </div>
          <code class="text-[11px] text-zinc-400">{{ task.id }}</code>
        </div>
        <NuxtLink v-if="task.topic?.path" :to="task.topic.path" class="mt-3 block font-serif text-lg text-zinc-900 hover:text-emerald-800 hover:underline">{{ task.baseRevision?.title || task.topic.path }}</NuxtLink>
        <p v-else class="mt-3 font-serif text-lg text-zinc-900">Новая страница</p>
        <p class="mt-1 text-xs text-zinc-500">Решений: {{ task.solutionCount }} · цикл {{ task.cycle }}</p>
        <div v-if="task.canManage" class="mt-3 flex flex-wrap gap-2">
          <UButton size="xs" color="neutral" variant="outline" @click="loadDetails(task)">Решения и управление</UButton>
          <UButton v-if="task.status !== 'resolved'" size="xs" color="neutral" variant="ghost" @click="manageTask(task, 'resolve')">Закрыть задачу</UButton>
          <UButton v-else size="xs" color="neutral" variant="ghost" @click="manageTask(task, 'reopen')">Открыть снова</UButton>
        </div>
        <div v-if="details[task.id]" class="mt-3 space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <p v-if="!details[task.id].solutions?.length" class="text-sm text-zinc-600">Решений пока нет.</p>
          <div v-for="solution in details[task.id].solutions" :key="solution.id" class="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2"><span class="font-semibold text-zinc-900">{{ solution.submitter?.name || solution.submitter?.username || 'Участник' }}</span><span class="text-xs text-zinc-500">{{ solution.status }}<span v-if="solution.model"> · {{ solution.model }}</span></span></div>
            <p class="mt-2 whitespace-pre-line text-zinc-700">{{ solution.payload?.summary || solution.payload?.overview || solution.payload?.body || '' }}</p>
            <div v-if="['submitted', 'partially_accepted'].includes(solution.status)" class="mt-3 flex flex-wrap gap-2"><UButton size="xs" color="primary" @click="reviewTask(task, solution, 'accept')">Принять</UButton><UButton size="xs" color="neutral" variant="outline" @click="reviewTask(task, solution, 'reject')">Отклонить</UButton></div>
          </div>
        </div>

        <div v-if="!actor" class="mt-4 text-sm text-zinc-600"><NuxtLink to="/login" class="font-semibold text-emerald-800 underline">Войдите</NuxtLink>, чтобы взять задачу.</div>
        <div v-else-if="task.claimedBy === actor.id" class="mt-4 space-y-3">
          <label v-if="needsTitle(task.type)" class="grid gap-1 text-sm font-medium text-zinc-800">Заголовок<input v-model="drafts[task.id].title" maxlength="180" class="rounded-lg border border-zinc-300 bg-white p-2.5 font-normal"></label>
          <label v-if="needsBody(task.type)" class="grid gap-1 text-sm font-medium text-zinc-800">{{ task.type === 'answer_question' ? 'Ответ' : task.type === 'update_overview' ? 'Краткий обзор' : 'Текст решения' }}<textarea v-model="drafts[task.id].body" rows="5" maxlength="40000" class="rounded-lg border border-zinc-300 bg-white p-2.5 font-normal"></textarea></label>
          <label v-if="task.type === 'write_article'" class="grid gap-1 text-sm font-medium text-zinc-800">Источник<input v-model="drafts[task.id].source" placeholder="https://example.org/source" class="rounded-lg border border-zinc-300 bg-white p-2.5 font-normal"></label>
          <div class="flex flex-wrap gap-2">
            <UButton color="primary" :disabled="busy === task.id" @click="submitTask(task)">{{ busy === task.id ? 'Отправка…' : 'Отправить решение' }}</UButton>
            <UButton color="neutral" variant="outline" :disabled="busy === task.id" @click="releaseTask(task)">Освободить</UButton>
          </div>
        </div>
        <div v-else class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-700">
          <span v-if="task.status === 'claimed'">Задача уже взята: {{ task.claimActor || 'другим участником' }}</span>
          <span v-else>Можно взять задачу на 2 часа.</span>
          <UButton color="primary" :disabled="busy === task.id || task.status !== 'open'" @click="claimTask(task)">{{ task.status === 'open' ? 'Взять задачу' : 'Занята' }}</UButton>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
const { data: authState } = await useFetch('/api/auth/me')
const actor = computed(() => authState.value?.actor || null)
const { data, pending, error, refresh: loadTasks } = await useFetch('/api/tasks', { query: { status: 'active', limit: 20 }, default: () => ({ items: [] }) })
const items = computed(() => data.value?.items || [])
const drafts = reactive({})
const details = reactive({})
const busy = ref('')
watch(items, (next) => { for (const task of next) if (!drafts[task.id]) drafts[task.id] = { title: task.baseRevision?.title || '', body: '', source: '' } }, { immediate: true })

function typeLabel(type, reason) {
  if (type === 'answer_question' && reason === 'no_reply') return 'Ответить в обсуждении'
  return ({ edit_article: 'Правка статьи', answer_question: 'Ответ на вопрос', translate: 'Проверка перевода', update_overview: 'Краткий обзор', write_article: 'Новая статья', write_discussion: 'Новая дискуссия', fill_page: 'Заполнить страницу' })[type] || type
}
function reasonLabel(reason) {
  return ({
    no_answer: 'Нет ответа на вопрос',
    no_reply: 'Нет ответа в обсуждении',
    missing_overview: 'Нет краткого обзора',
    new_replies: 'Новые ответы — обзор устарел',
    question_three_answers: 'Вопрос получил 3 ответа',
    discussion_three_answers: 'Обсуждение получило 3 ответа',
  })[reason] || reason
}
function statusLabel(status) { return ({ open: 'Открыта', claimed: 'В работе', submitted: 'Отправлено', under_review: 'На проверке', resolved: 'Закрыта' })[status] || status }
function needsTitle(type) { return ['edit_article', 'translate', 'write_article', 'write_discussion', 'fill_page'].includes(type) }
function needsBody() { return true }
async function run(task, action) {
  busy.value = task.id
  try { await action(); await loadTasks() } finally { busy.value = '' }
}
function claimTask(task) { return run(task, () => $fetch(`/api/tasks/${task.id}/claim`, { method: 'POST', body: { action: 'claim' } })) }
function releaseTask(task) { return run(task, () => $fetch(`/api/tasks/${task.id}/claim`, { method: 'POST', body: { action: 'release' } })) }
function loadDetails(task) { return run(task, async () => { details[task.id] = (await $fetch(`/api/tasks/${task.id}`)).task }) }
function manageTask(task, action) { return run(task, () => $fetch(`/api/tasks/${task.id}/manage`, { method: 'PATCH', body: { action } })) }
function reviewTask(task, solution, action) { return run(task, async () => { await $fetch(`/api/tasks/${task.id}/review`, { method: 'PATCH', body: { action, solutionId: solution.id, comment: action === 'accept' ? 'Принято автором страницы.' : 'Отклонено автором страницы.' } }); details[task.id] = (await $fetch(`/api/tasks/${task.id}`)).task }) }
function submitTask(task) {
  return run(task, () => {
    const draft = drafts[task.id]
    const body = task.type === 'update_overview' ? { overview: draft.body, locale: task.sourceLocale || 'en' } : {
      title: draft.title,
      body: draft.body,
      locale: task.targetLocale || task.sourceLocale || 'en',
      sources: draft.source ? [{ url: draft.source }] : [],
    }
    return $fetch(`/api/tasks/${task.id}/solutions`, { method: 'POST', body })
  })
}
</script>
