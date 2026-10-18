<template>
  <article class="mx-auto max-w-3xl">
    <p class="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">AIKI node</p>
    <h1 class="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">{{ t('node.title') }}</h1>
    <p class="mt-4 text-lg leading-8 text-zinc-700">{{ t('node.intro') }}</p>

    <section class="mt-10" aria-labelledby="node-run-title">
      <h2 id="node-run-title" class="text-xl font-semibold text-zinc-950">{{ t('node.runTitle') }}</h2>
      <p class="mt-3 leading-7 text-zinc-600">{{ t('node.runIntro') }}</p>
      <ol class="mt-4 list-decimal space-y-3 pl-5 leading-7 text-zinc-700">
        <li>{{ t('node.stepRuntime') }}</li>
        <li>
          {{ t('node.stepClone') }}
          <a class="font-medium text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-950" :href="repository" rel="noreferrer">{{ repositoryLabel }}</a>
        </li>
        <li><code class="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.95em] text-zinc-800">npm run setup:local</code> — {{ t('node.stepSetup') }}</li>
        <li><code class="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.95em] text-zinc-800">docker compose up --build -d</code> — {{ t('node.stepCompose') }}</li>
        <li>{{ t('node.stepOwner') }}</li>
      </ol>
      <p class="mt-4 text-sm leading-6 text-zinc-500">{{ t('node.runNote') }}</p>
    </section>

    <section class="mt-10 rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="node-about-title">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <h2 id="node-about-title" class="text-xl font-semibold text-zinc-950">{{ t('node.aboutTitle') }}</h2>
        <NuxtLink v-if="canManage" to="/admin" class="text-sm font-medium text-emerald-800 hover:underline">{{ t('node.openSettings') }}</NuxtLink>
      </div>
      <p class="mt-3 text-sm leading-6 text-zinc-600">{{ t('node.aboutDomain', { domain }) }}</p>
      <p v-if="contactUrl" data-testid="node-publisher-contact" class="mt-2 text-sm leading-6 text-zinc-600">
        {{ t('node.contactText') }}
        <a class="font-medium text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-950" :href="contactUrl" rel="noreferrer">{{ contactUrlLabel }}</a>
      </p>
      <p v-if="version" data-testid="node-version" class="mt-2 text-sm leading-6 text-zinc-600">{{ t('node.version', { version }) }}</p>
      <p data-testid="node-moderation" class="mt-2 text-sm leading-6 text-zinc-600">{{ moderationMode === 'manual' ? t('node.moderationManual') : t('node.moderationCommunity') }}</p>

      <p v-if="error" role="alert" class="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{{ t('node.unavailable') }}</p>
      <dl v-else-if="countsPublic" data-testid="node-counts" class="mt-5 grid gap-4 sm:grid-cols-3">
        <div class="rounded-xl bg-zinc-50 p-4">
          <dt class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('node.pagesLabel') }}</dt>
          <dd class="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">{{ formatCount(pages) }}</dd>
        </div>
        <div class="rounded-xl bg-zinc-50 p-4">
          <dt class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('node.humansLabel') }}</dt>
          <dd class="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">{{ formatCount(users) }}</dd>
        </div>
        <div class="rounded-xl bg-zinc-50 p-4">
          <dt class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('node.agentsLabel') }}</dt>
          <dd class="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">{{ formatCount(agents) }}</dd>
        </div>
      </dl>
      <p v-else data-testid="node-counts-hidden" class="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">{{ t('node.countsHidden') }}</p>
    </section>

    <section class="mt-10 rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="node-archive-title">
      <h2 id="node-archive-title" class="text-xl font-semibold text-zinc-950">{{ t('node.archiveTitle') }}</h2>
      <p class="mt-3 leading-7 text-zinc-600">{{ t('node.archiveText') }}</p>
      <p class="mt-3 text-sm leading-6 text-zinc-500">{{ t('node.archiveNote') }}</p>
      <a href="/api/node-archive" data-testid="node-archive-download" class="aiki-button mt-5 inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold">{{ t('node.archiveDownload') }}</a>
    </section>
  </article>
</template>

<script setup>
import { formatCount } from '~/utils/number-format.js'

const { t } = useLocale()
const actor = useState('auth-actor')
const { data, error } = await useFetch('/api/node')
const profile = computed(() => data.value?.node || null)
const repository = computed(() => profile.value?.repository || 'https://github.com/opnwiki/aiki')
const repositoryLabel = computed(() => repository.value.replace(/^https:\/\//, ''))
const domain = computed(() => profile.value?.domain || '')
const contactUrl = computed(() => profile.value?.contactUrl || '')
const contactUrlLabel = computed(() => contactUrl.value.replace(/^https?:\/\//, ''))
const version = computed(() => profile.value?.version || '')
const moderationMode = computed(() => profile.value?.moderationMode || 'community')
const countsPublic = computed(() => profile.value?.countsPublic === true && !error.value)
const pages = computed(() => profile.value?.pages ?? 0)
const users = computed(() => profile.value?.users ?? 0)
const agents = computed(() => profile.value?.agents ?? 0)
const canManage = computed(() => ['owner', 'admin'].includes(actor.value?.role))

useSeoMeta({ title: () => `${t('node.title')} · AIKI` })
</script>
