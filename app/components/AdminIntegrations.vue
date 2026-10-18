<template>
  <section data-testid="admin-integrations" class="mt-8 min-w-0 rounded-2xl border border-zinc-200 bg-white p-6">
    <h2 class="text-sm font-semibold text-zinc-950">{{ t('integrations.title') }}</h2>
    <p class="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">{{ t('integrations.hint') }}</p>
    <p v-if="data && !data.enabled" data-testid="integrations-disabled" class="mt-4 rounded-lg bg-amber-100 p-3 text-xs leading-5 text-amber-900">{{ t('integrations.disabled') }}</p>
    <p v-if="error" role="alert" class="mt-4 text-sm text-red-800">{{ t('integrations.unavailable') }}</p>

    <ul v-if="credentials.length" class="mt-5 space-y-2">
      <li v-for="item in credentials" :key="item.id" data-testid="integration-credential" class="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-zinc-200 p-3 text-sm" :class="item.revoked_at ? 'opacity-60' : ''">
        <div class="min-w-0">
          <p class="font-semibold text-zinc-900">{{ item.label }} <span class="ml-1 font-normal text-zinc-500">{{ item.connector }} · {{ item.identity_providers.join(', ') }}</span></p>
          <p class="mt-1 break-all font-mono text-xs text-zinc-500">{{ item.token_prefix }}…</p>
          <p class="mt-1 text-xs text-zinc-500">{{ item.scopes.join(', ') }}<span v-if="item.allowed_media_origins.length"> · {{ item.allowed_media_origins.join(', ') }}</span></p>
          <p class="mt-1 text-xs text-zinc-500">
            {{ t('integrations.created', { date: formatDate(item.created_at) }) }}
            <span v-if="item.last_used_at"> · {{ t('integrations.lastUsed', { date: formatDate(item.last_used_at) }) }}</span>
            <span v-if="item.revoked_at"> · {{ t('integrations.revoked', { date: formatDate(item.revoked_at) }) }}</span>
          </p>
        </div>
        <button v-if="!item.revoked_at" type="button" data-testid="integration-revoke" class="shrink-0 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60" :disabled="pending" @click="revoke(item)">{{ t('integrations.revoke') }}</button>
      </li>
    </ul>
    <p v-else-if="data" class="mt-5 text-sm text-zinc-500">{{ t('integrations.empty') }}</p>

    <div v-if="createdToken" data-testid="integration-token" class="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p class="text-sm font-semibold text-amber-900">{{ t('integrations.tokenOnce') }}</p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <code class="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-zinc-900">{{ createdToken }}</code>
        <button type="button" class="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50" @click="copyToken">{{ copied ? t('account.copied') : t('integrations.copy') }}</button>
      </div>
    </div>

    <form class="mt-6 grid gap-3 border-t border-zinc-100 pt-5 sm:grid-cols-2" @submit.prevent="create">
      <h3 class="text-sm font-semibold text-zinc-950 sm:col-span-2">{{ t('integrations.newTitle') }}</h3>
      <label class="grid min-w-0 gap-1 text-sm font-medium text-zinc-700 sm:col-span-2">{{ t('integrations.label') }}
        <input v-model="form.label" data-testid="integration-label" required maxlength="80" class="w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 font-normal" :placeholder="t('integrations.labelPlaceholder')">
      </label>
      <label class="grid min-w-0 gap-1 text-sm font-medium text-zinc-700">{{ t('integrations.connector') }}
        <input v-model="form.connector" data-testid="integration-connector" required maxlength="64" pattern="[a-z][a-z0-9_\-]{1,63}" class="w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono font-normal">
      </label>
      <label class="grid min-w-0 gap-1 text-sm font-medium text-zinc-700">{{ t('integrations.providers') }}
        <input v-model="form.providers" data-testid="integration-providers" required class="w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono font-normal">
        <span class="text-xs font-normal leading-5 text-zinc-500">{{ t('integrations.providersHint') }}</span>
      </label>
      <label class="grid min-w-0 gap-1 text-sm font-medium text-zinc-700 sm:col-span-2">{{ t('integrations.mediaOrigin') }}
        <input v-model="form.mediaOrigins" data-testid="integration-media" class="w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono font-normal" placeholder="https://media.example.org">
        <span class="text-xs font-normal leading-5 text-zinc-500">{{ t('integrations.mediaOriginHint') }}</span>
      </label>
      <fieldset class="grid gap-2 sm:col-span-2">
        <legend class="text-sm font-medium text-zinc-700">{{ t('integrations.scopes') }}</legend>
        <label v-for="scope in SCOPES" :key="scope" class="flex items-center gap-2 text-sm text-zinc-800">
          <input v-model="form.scopes" type="checkbox" :value="scope" class="accent-emerald-700">
          <code class="font-mono text-xs">{{ scope }}</code>
        </label>
      </fieldset>
      <p v-if="formError" role="alert" class="text-sm text-red-800 sm:col-span-2">{{ formError }}</p>
      <div class="sm:col-span-2">
        <button type="submit" data-testid="integration-create" class="aiki-button w-full rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60 sm:w-auto" :disabled="pending || !form.scopes.length">{{ t('integrations.create') }}</button>
      </div>
    </form>
  </section>
</template>

<script setup>
const { t, locale } = useLocale()
const SCOPES = ['imports:read', 'imports:write', 'account-links:write']

const { data, error, refresh } = await useFetch('/api/admin/integrations', { key: 'admin-integrations' })
const credentials = computed(() => data.value?.credentials || [])
const pending = ref(false)
const formError = ref('')
const createdToken = ref('')
const copied = ref(false)
const form = reactive({ label: '', connector: 'telegram', providers: 'telegram, web', mediaOrigins: '', scopes: [...SCOPES] })

function formatDate(value) {
  return value ? new Date(value).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' }) : ''
}

function splitList(value) {
  return value.split(/[\s,]+/).map(item => item.trim()).filter(Boolean)
}

async function create() {
  pending.value = true
  formError.value = ''
  createdToken.value = ''
  copied.value = false
  const identityProviders = splitList(form.providers)
  try {
    const result = await $fetch('/api/admin/integrations', {
      method: 'POST',
      body: {
        label: form.label,
        connector: form.connector,
        provider: identityProviders[0] || '',
        identityProviders,
        allowedMediaOrigins: splitList(form.mediaOrigins),
        scopes: form.scopes,
      },
    })
    createdToken.value = result.token
    form.label = ''
    await refresh()
  } catch (requestError) {
    formError.value = requestError?.data?.statusMessage || t('integrations.createFailed')
  } finally {
    pending.value = false
  }
}

async function revoke(item) {
  if (!window.confirm(t('integrations.revokeConfirm', { label: item.label }))) return
  pending.value = true
  try {
    await $fetch(`/api/admin/integrations/${item.id}`, { method: 'DELETE' })
    await refresh()
  } catch (requestError) {
    formError.value = requestError?.data?.statusMessage || t('integrations.revokeFailed')
  } finally {
    pending.value = false
  }
}

async function copyToken() {
  try {
    await navigator.clipboard.writeText(createdToken.value)
    copied.value = true
  } catch {
    copied.value = false
  }
}
</script>
