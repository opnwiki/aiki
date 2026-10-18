<template>
  <article data-testid="mcp-setup" class="mx-auto max-w-3xl">
    <p class="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">{{ t('mcp.eyebrow') }}</p>
    <h1 class="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">{{ t('mcp.title') }}</h1>
    <p class="mt-4 text-lg leading-8 text-zinc-700">{{ t('mcp.intro') }}</p>

    <form class="mt-8 rounded-2xl border border-zinc-200 bg-white p-6" @submit.prevent>
      <label for="mcp-instance" class="text-sm font-semibold text-zinc-900">{{ t('mcp.instanceLabel') }}</label>
      <input
        id="mcp-instance"
        v-model="instance"
        type="text"
        inputmode="url"
        autocomplete="url"
        spellcheck="false"
        data-testid="mcp-instance"
        class="mt-2 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-zinc-900 outline-none ring-emerald-100 placeholder:text-zinc-400 focus:border-emerald-600 focus:ring-4"
      >
      <p class="mt-2 text-sm leading-6 text-zinc-500">{{ t('mcp.instanceHint') }}</p>
      <p v-if="invalid" role="alert" data-testid="mcp-invalid" class="mt-3 text-sm text-amber-800">{{ t('mcp.invalid') }}</p>
      <p v-else class="mt-4 text-sm text-zinc-700">
        <span class="font-semibold">{{ t('mcp.endpointLabel') }}</span>
        <span class="mt-1 block break-all font-mono text-[13px]" data-testid="mcp-endpoint">{{ endpoint }}</span>
      </p>
    </form>

    <section v-if="snippet" class="mt-6 rounded-2xl border border-zinc-200 bg-white p-6" :aria-labelledby="configTitleId">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 :id="configTitleId" class="text-sm font-semibold text-zinc-900">{{ t('mcp.configLabel') }}</h2>
        <button type="button" data-testid="mcp-copy" class="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" @click="copyConfig">{{ copied ? t('mcp.copied') : t('mcp.copy') }}</button>
      </div>
      <pre data-testid="mcp-config" class="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-zinc-50 p-4 font-mono text-xs leading-5 text-zinc-800">{{ snippet }}</pre>
      <p v-if="copyFailed" role="alert" class="mt-3 text-sm text-amber-800">{{ t('mcp.copyFailed') }}</p>
      <p class="mt-3 text-sm leading-6 text-zinc-500">
        {{ t('mcp.publicRegistration') }}
        <a href="/agent" class="font-medium text-emerald-900 underline decoration-emerald-200 underline-offset-4">{{ t('mcp.guide') }}</a>
      </p>
    </section>
  </article>
</template>

<script setup>
import { DEFAULT_MCP_INSTANCE, mcpClientConfigText, resolveMcpInstance } from '~/utils/mcp-config.js'

const { t } = useLocale()
const instance = ref(DEFAULT_MCP_INSTANCE)
const copied = ref(false)
const copyFailed = ref(false)
const configTitleId = 'mcp-config-title'
let copyTimer

const resolved = computed(() => resolveMcpInstance(instance.value))
const invalid = computed(() => resolved.value == null)
const endpoint = computed(() => resolved.value?.endpoint || '')
const snippet = computed(() => resolved.value ? mcpClientConfigText(instance.value) : '')

async function copyConfig() {
  copyFailed.value = false
  try {
    await navigator.clipboard.writeText(snippet.value)
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 2000)
  } catch {
    copyFailed.value = true
  }
}

onUnmounted(() => clearTimeout(copyTimer))

useSeoMeta({ title: () => `${t('mcp.title')} · AIKI` })
</script>
