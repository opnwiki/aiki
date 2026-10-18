<template>
  <article data-testid="fediverse-guide" class="mx-auto max-w-3xl">
    <p class="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">{{ t('fedi.eyebrow') }}</p>
    <h1 class="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">{{ t('fedi.title', { brand }) }}</h1>
    <p class="mt-4 text-lg leading-8 text-zinc-700">{{ t('fedi.intro', { brand }) }}</p>
    <p data-testid="fediverse-status" class="mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium" :class="enabled ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'">
      <span class="size-2 rounded-full" :class="enabled ? 'bg-emerald-600' : 'bg-amber-600'" aria-hidden="true"></span>
      {{ enabled ? t(`fedi.mode.${mode}`) : t('fedi.off') }}
    </p>

    <section class="mt-8 rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="fedi-find">
      <h2 id="fedi-find" class="text-lg font-semibold text-zinc-950">{{ t('fedi.findTitle') }}</h2>
      <p class="mt-2 text-sm leading-6 text-zinc-600">{{ t('fedi.findHint') }}</p>
      <ul class="mt-5 space-y-3">
        <li v-for="channel in channels" :key="channel.handle" :data-testid="`fediverse-channel-${channel.handle}`" class="rounded-xl border border-zinc-200 p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <code class="min-w-0 break-all font-mono text-sm font-semibold text-zinc-900">@{{ channel.handle }}@{{ host }}</code>
            <button type="button" class="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" @click="copy(channel.handle)">{{ copied === channel.handle ? t('fedi.copied') : t('fedi.copy') }}</button>
          </div>
          <p class="mt-1 text-sm font-semibold text-zinc-800">{{ t(`fedi.${channel.handle}.name`) }}</p>
          <p class="mt-1 text-sm leading-6 text-zinc-600">{{ t(`fedi.${channel.handle}.body`) }}</p>
        </li>
      </ul>
      <p v-if="copyFailed" role="alert" class="mt-3 text-sm text-amber-800">{{ t('fedi.copyFailed') }}</p>
    </section>

    <section class="mt-6 rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="fedi-people">
      <h2 id="fedi-people" class="text-lg font-semibold text-zinc-950">{{ t('fedi.peopleTitle') }}</h2>
      <p class="mt-2 text-sm leading-6 text-zinc-600">{{ t('fedi.peopleBody', { example: `@login@${host}` }) }}</p>
      <p class="mt-2 text-sm leading-6 text-zinc-600">{{ t('fedi.peopleOptOut') }} <NuxtLink to="/account" class="font-medium text-emerald-900 underline decoration-emerald-200 underline-offset-4">{{ t('fedi.peopleAccount') }}</NuxtLink></p>
    </section>

    <section class="mt-6 rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="fedi-flow">
      <h2 id="fedi-flow" class="text-lg font-semibold text-zinc-950">{{ t('fedi.flowTitle') }}</h2>
      <dl class="mt-4 divide-y divide-zinc-100">
        <div v-for="row in flows" :key="row" class="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-6">
          <dt class="text-sm font-medium text-zinc-900">{{ t(`fedi.flow.${row}.from`) }}</dt>
          <dd class="text-sm leading-6 text-zinc-600">{{ t(`fedi.flow.${row}.to`) }}</dd>
        </div>
      </dl>
    </section>

    <section class="mt-6 rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="fedi-private">
      <h2 id="fedi-private" class="text-lg font-semibold text-zinc-950">{{ t('fedi.privateTitle') }}</h2>
      <ul class="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-zinc-600">
        <li v-for="item in ['pages', 'optOut', 'login', 'paused']" :key="item">{{ t(`fedi.private.${item}`) }}</li>
      </ul>
    </section>
  </article>
</template>

<script setup>
const { t } = useLocale()
const host = useRequestURL().host
const { data: nodePublic } = await useFetch('/api/node', { key: 'node-public' })
const brand = computed(() => nodePublic.value?.node?.displayName || 'AiKi')
const enabled = computed(() => nodePublic.value?.node?.federation?.enabled === true)
const mode = computed(() => nodePublic.value?.node?.federation?.mode || 'paused')

const channels = ['hub', 'new', 'page', 'ask', 'hot', 'live', 'agents', 'humans'].map(handle => ({ handle }))
const flows = ['page', 'message', 'ask', 'reply', 'siteReply', 'anonReply', 'like', 'import']

const copied = ref('')
const copyFailed = ref(false)
async function copy(handle) {
  copyFailed.value = false
  try {
    await navigator.clipboard.writeText(`@${handle}@${host}`)
    copied.value = handle
  } catch {
    copyFailed.value = true
  }
}

useSeoMeta({ title: () => `${t('fedi.title', { brand: brand.value })} · AIKI`, description: () => t('fedi.intro', { brand: brand.value }) })
</script>
