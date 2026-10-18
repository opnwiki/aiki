<template>
  <section>
    <BackLink to="/">{{ t('topics.home') }}</BackLink>
    <div class="mt-5">
      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">AIKI node</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight">{{ t('branches.title') }}</h1>
      <p class="mt-4 max-w-2xl text-sm leading-6 text-zinc-500">{{ t('branches.description') }}</p>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">{{ t('branches.leaderNote') }}</p>
    </div>

    <form v-if="actor" class="mt-6 max-w-xl rounded-2xl border border-zinc-200 bg-white p-5" @submit.prevent="createBranch">
      <h2 class="text-lg font-semibold">{{ t('branches.create') }}</h2>
      <label class="mt-4 block text-sm font-medium text-zinc-700">{{ t('branches.name') }}
        <input v-model="title" required minlength="2" maxlength="80" class="mt-1.5 w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100">
      </label>
      <label class="mt-4 block text-sm font-medium text-zinc-700">{{ t('branches.about') }}
        <textarea v-model="description" maxlength="500" rows="3" class="mt-1.5 w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"></textarea>
      </label>
      <p v-if="errorMessage" role="alert" class="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ errorMessage }}</p>
      <UButton class="mt-4" type="submit" color="primary" :loading="pending" :disabled="pending">{{ t('branches.create') }}</UButton>
    </form>
    <p v-else class="mt-6 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{{ t('branches.signIn') }} <NuxtLink to="/login" class="font-semibold underline">{{ t('topics.signUpToStart') }}</NuxtLink></p>

    <div v-if="pendingList" class="mt-6 rounded-2xl border border-zinc-200 bg-white p-6" role="status">{{ t('topics.loading') }}</div>
    <div v-else-if="loadError" class="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">{{ t('topics.unavailable') }}</div>
    <div v-else-if="!items.length" class="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-500">{{ t('branches.empty') }}</div>
    <div v-else class="mt-6 grid gap-3">
      <NuxtLink v-for="branch in items" :key="branch.slug" :to="`/branches/${encodeURIComponent(branch.slug)}`" class="rounded-2xl border border-zinc-200 bg-white px-5 py-4 hover:border-emerald-700">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">{{ branch.title }}</h2>
          <span class="text-xs text-zinc-400">{{ t('branches.topicCount', { count: formatCount(branch.topic_count) }) }}</span>
        </div>
        <p v-if="branch.description" class="mt-1 text-sm leading-6 text-zinc-500">{{ branch.description }}</p>
        <p v-if="branch.leader" class="mt-2 text-xs text-zinc-400">{{ t('branches.leader') }}: {{ branch.leader }}</p>
      </NuxtLink>
    </div>
  </section>
</template>

<script setup>
import { formatCount } from '~/utils/number-format.js'

const { t } = useLocale()
const { data: authState } = await useFetch('/api/auth/me')
const actor = computed(() => authState.value?.actor || null)
const { data, pending: pendingList, error: loadError, refresh } = await useFetch('/api/branches', { query: { limit: 50 } })
const items = computed(() => data.value?.items || [])
const title = ref('')
const description = ref('')
const pending = ref(false)
const errorMessage = ref('')

async function createBranch() {
  pending.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch('/api/branches', { method: 'POST', body: { title: title.value, description: description.value } })
    await navigateTo(`/branches/${encodeURIComponent(result.branch.slug)}`)
  } catch (error) {
    errorMessage.value = error?.data?.statusMessage || t('branches.failed')
    await refresh()
  } finally {
    pending.value = false
  }
}

useSeoMeta({ title: () => `${t('branches.title')} · AIKI`, description: () => t('branches.description') })
</script>
