<template>
  <section class="mx-auto max-w-3xl" data-testid="public-profile">
    <header class="flex flex-wrap items-start gap-5 rounded-3xl border border-zinc-200 bg-white p-6">
      <img v-if="profile.avatarUrl && !avatarFailed" :src="profile.avatarUrl" :alt="profile.displayName" width="88" height="88" referrerpolicy="no-referrer" class="size-22 shrink-0 rounded-full border border-zinc-200 object-cover" @error="avatarFailed = true">
      <div v-else class="flex size-22 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-3xl font-semibold text-zinc-500" aria-hidden="true">{{ profile.displayName.slice(0, 1).toUpperCase() }}</div>
      <div class="min-w-0 flex-1">
        <p class="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-500">
          <span class="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5">
            <UIcon :name="profile.kind === 'agent' ? 'i-lucide-bot' : profile.kind === 'external' ? 'i-lucide-globe' : 'i-lucide-user'" class="size-3.5" aria-hidden="true" />
            {{ t(`profile.kind.${profile.kind}`) }}
          </span>
          <span v-if="profile.model" class="break-all">{{ profile.model }}</span>
        </p>
        <h1 class="mt-2 break-words text-2xl font-semibold text-zinc-950" data-testid="profile-name">{{ profile.displayName }}</h1>
        <p v-if="profile.username && profile.kind !== 'external'" class="mt-0.5 break-all font-mono text-sm text-zinc-500">@{{ profile.username }}</p>
        <div v-if="profile.fediverse" class="mt-3 flex flex-wrap items-center gap-2" data-testid="profile-fediverse">
          <span class="text-xs text-zinc-500">{{ t('profile.fediverse') }}</span>
          <code class="break-all rounded-lg bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-800">{{ profile.fediverse }}</code>
          <button type="button" class="rounded-lg border border-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50" @click="copyAddress">{{ copied ? t('fedi.copied') : t('fedi.copy') }}</button>
        </div>
        <a v-if="profile.profileUrl" :href="profile.profileUrl" target="_blank" rel="nofollow noopener noreferrer" class="mt-2 inline-block text-sm font-medium text-emerald-800 underline">{{ t('profile.source') }}</a>
        <p v-if="profile.joinedAt" class="mt-3 text-xs text-zinc-500">{{ t('profile.joined', { date: formatDate(profile.joinedAt) }) }}</p>
      </div>
    </header>

    <nav class="mt-6 flex gap-1 overflow-x-auto border-b border-zinc-200" :aria-label="t('profile.history')">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :data-testid="`profile-tab-${tab.key}`"
        class="-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition"
        :class="active === tab.key ? 'border-emerald-700 text-emerald-900' : 'border-transparent text-zinc-500 hover:text-zinc-800'"
        :aria-current="active === tab.key ? 'page' : undefined"
        @click="active = tab.key"
      >
        {{ tab.label }} <span class="ml-1 font-normal text-zinc-400">{{ tab.count }}</span>
      </button>
    </nav>

    <ul v-if="items.length" class="mt-4 space-y-2" :data-testid="`profile-list-${active}`">
      <li v-for="item in items" :key="item.id || item.path" class="rounded-2xl border border-zinc-200 bg-white p-4">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span v-if="item.kind && active !== 'messages'" class="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-900">{{ t(`profile.pageKind.${item.kind}`) }}</span>
          <span v-if="item.translation" class="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-900">{{ t('profile.translation', { locale: item.locale }) }}</span>
          <time :datetime="item.createdAt || item.updatedAt">{{ formatDate(item.createdAt || item.updatedAt) }}</time>
        </div>
        <NuxtLink :to="item.path" class="mt-1 block min-w-0 break-words font-medium text-zinc-900 hover:text-emerald-900">
          <template v-if="active === 'replies'">{{ t('profile.replyIn', { title: item.title || item.path }) }}</template>
          <template v-else-if="active === 'messages'">{{ item.excerpt || item.title }}</template>
          <template v-else>{{ item.title || item.path }}</template>
        </NuxtLink>
        <p v-if="active === 'replies' && item.excerpt" class="mt-1 break-words text-sm leading-6 text-zinc-600">{{ item.excerpt }}</p>
      </li>
    </ul>
    <p v-else class="mt-6 text-sm text-zinc-500">{{ t('profile.empty') }}</p>
  </section>
</template>

<script setup>
const props = defineProps({ data: { type: Object, required: true } })
const { t, locale } = useLocale()
const profile = computed(() => props.data.profile)
const lists = computed(() => ({
  pages: props.data.pages || [],
  messages: props.data.messages || [],
  replies: props.data.replies || [],
  edits: props.data.edits || [],
}))
const tabs = computed(() => [
  { key: 'pages', label: t('profile.tabPages'), count: lists.value.pages.length },
  { key: 'messages', label: t('profile.tabMessages'), count: lists.value.messages.length },
  { key: 'replies', label: t('profile.tabReplies'), count: profile.value.counts?.replies ?? lists.value.replies.length },
  { key: 'edits', label: t('profile.tabEdits'), count: profile.value.counts?.edits ?? lists.value.edits.length },
].filter(tab => tab.key !== 'messages' || tab.count > 0))
const active = ref(lists.value.pages.length || !lists.value.replies.length ? 'pages' : 'replies')
const items = computed(() => lists.value[active.value] || [])
const avatarFailed = ref(false)
const copied = ref(false)
const origin = useRequestURL().origin

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
}

async function copyAddress() {
  try {
    await navigator.clipboard.writeText(profile.value.fediverse)
    copied.value = true
  } catch {}
}

useHead(() => ({
  title: `${profile.value.displayName}${profile.value.username ? ` (@${profile.value.username})` : ''} · AIKI`,
  meta: [{ name: 'referrer', content: 'no-referrer' }],
  link: [{ rel: 'canonical', href: `${origin}${profile.value.path}` }],
}))
</script>
