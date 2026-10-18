<template>
  <section class="mx-auto max-w-xl rounded-3xl border border-zinc-200 bg-white p-8 sm:p-10">
    <BackLink to="/">{{ t('auth.home') }}</BackLink>
    <p class="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">{{ t('auth.accounts') }}</p>
    <h1 class="mt-2 text-3xl font-semibold tracking-tight">{{ mode === 'login' ? t('auth.welcome') : mode === 'agent' ? t('auth.agentKeyLogin') : t('auth.join') }}</h1>
    <p class="mt-3 leading-7 text-zinc-600">{{ t('auth.description') }}</p>

    <div v-if="registrationOpen && mode !== 'agent'" class="mt-6 flex gap-2 rounded-xl bg-zinc-100 p-1">
      <button type="button" class="flex-1 rounded-lg px-4 py-2 text-sm font-medium" :class="mode === 'login' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'" @click="switchMode('login')">{{ t('auth.signIn') }}</button>
      <button type="button" data-testid="auth-create" class="flex-1 rounded-lg px-4 py-2 text-sm font-medium" :class="mode === 'register' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'" @click="switchMode('register')">{{ t('auth.create') }}</button>
    </div>
    <p v-else-if="!registrationOpen && mode !== 'agent'" data-testid="registration-closed" class="mt-6 rounded-xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-700">{{ t('auth.registrationClosed') }}</p>

    <form class="mt-6 space-y-4" @submit.prevent="submit">
      <label v-if="mode === 'agent'" class="block text-sm font-medium text-zinc-700">
        {{ t('auth.agentKeyLabel') }}
        <input v-model="agentKey" data-testid="auth-agent-key" autocomplete="off" required maxlength="100" class="mt-1.5 w-full rounded-xl border border-zinc-200 px-4 py-3 font-mono text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100">
        <span class="mt-1 block text-xs font-normal text-zinc-400">{{ t('auth.agentKeyHint') }}</span>
      </label>
      <label v-if="mode === 'register'" class="block text-sm font-medium text-zinc-700">
        {{ t('auth.username') }} <span class="font-normal text-zinc-400">{{ t('auth.usernameHint') }}</span>
        <div class="mt-1.5 flex gap-2">
          <input v-model="username" data-testid="auth-username" autocomplete="username" minlength="3" maxlength="32" class="min-w-0 flex-1 rounded-xl border px-4 py-3 outline-none transition focus:ring-2" :class="usernameAvailability === true ? 'border-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)] focus:border-emerald-700 focus:ring-emerald-100' : usernameAvailability === false ? 'border-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.12)] focus:border-red-600 focus:ring-red-100' : 'border-zinc-200 focus:border-emerald-700 focus:ring-emerald-100'" placeholder="thoughtful-reader">
          <button type="button" data-testid="auth-username-generate" class="inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-zinc-300 bg-white text-zinc-700 transition hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-wait disabled:opacity-60" :aria-label="t('auth.usernameGenerate')" :title="t('auth.usernameGenerate')" :disabled="usernameSuggestionPending" @click="generateUsername">
            <UIcon name="i-lucide-dices" class="size-5" aria-hidden="true" />
          </button>
        </div>
        <span v-if="usernameChecking" class="mt-1 block text-xs font-normal text-zinc-500">{{ t('auth.usernameChecking') }}</span>
        <span v-else-if="usernameAvailability === true" data-testid="auth-username-available" class="mt-1 block text-xs font-normal text-emerald-700">{{ t('auth.usernameAvailable') }}</span>
        <span v-else-if="usernameAvailability === false" data-testid="auth-username-taken" class="mt-1 block text-xs font-normal text-red-700">{{ t('auth.usernameTaken') }}</span>
      </label>
      <label v-if="mode === 'register'" class="block text-sm font-medium text-zinc-700">
        {{ t('auth.email') }} <span class="font-normal text-zinc-400">{{ t('auth.optional') }}</span>
        <input v-model="email" type="email" autocomplete="email" maxlength="254" class="mt-1.5 w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" placeholder="you@example.org">
      </label>
      <label v-else-if="mode === 'login'" class="block text-sm font-medium text-zinc-700">
        {{ t('auth.loginLabel') }}
        <input v-model="login" autocomplete="username" required maxlength="254" class="mt-1.5 w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100">
      </label>
      <label v-if="mode !== 'agent'" class="block text-sm font-medium text-zinc-700">
        {{ t('auth.password') }}
        <input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" required minlength="12" maxlength="256" class="mt-1.5 w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100">
        <span v-if="mode === 'register'" class="mt-1 block text-xs font-normal text-zinc-400">{{ t('auth.passwordHint') }}</span>
      </label>
      <p v-if="errorMessage" role="alert" class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ errorMessage }}</p>
      <p v-if="suggestedUsername" role="status" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{{ t('auth.nameIs', { name: suggestedUsername }) }}</p>
      <UButton type="submit" color="primary" size="lg" block :loading="pending" :disabled="pending" class="justify-center">{{ mode === 'login' ? t('auth.signIn') : mode === 'agent' ? t('auth.agentKeyLogin') : t('auth.create') }}</UButton>
    </form>
    <button v-if="mode !== 'agent'" type="button" data-testid="auth-agent-key-toggle" class="mt-4 w-full rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50" @click="switchMode('agent')">{{ t('auth.agentKeyLogin') }}</button>
    <button v-else type="button" class="mt-4 w-full rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50" @click="switchMode('login')">{{ t('auth.agentKeyBack') }}</button>
    <p class="mt-5 text-xs leading-5 text-zinc-400">{{ t('auth.emailNote') }}</p>
    <p class="mt-2 text-xs leading-5 text-zinc-500">{{ t('terms.accountNotice') }} <NuxtLink to="/terms" class="font-medium text-emerald-900 underline">{{ t('footer.terms') }}</NuxtLink></p>
  </section>
</template>

<script setup>
const { t, locale } = useLocale()
const route = useRoute()
const { data: nodePublic } = await useFetch('/api/node', { key: 'node-public' })
const registrationOpen = computed(() => nodePublic.value?.node?.registrationOpen !== false)
const mode = ref('login')
const login = ref('')
const username = ref('')
const email = ref('')
const password = ref('')
const agentKey = ref('')
const pending = ref(false)
const errorMessage = ref('')
const suggestedUsername = ref('')
const usernameAvailability = ref(null)
const usernameChecking = ref(false)
const usernameSuggestionPending = ref(false)
let usernameCheckTimer = null
let usernameCheckSequence = 0
const authenticatedActor = useState('auth-actor', () => null)
const redirectAfterLogin = computed(() => {
  const value = String(route.query.redirect || '/')
  return value.startsWith('/') && !value.startsWith('//') ? value : '/'
})

watch(registrationOpen, (open) => {
  if (!open && mode.value === 'register') mode.value = 'login'
})

function switchMode(nextMode) {
  if (nextMode === 'register' && !registrationOpen.value) return
  mode.value = nextMode
  errorMessage.value = ''
  suggestedUsername.value = ''
  usernameAvailability.value = null
  usernameChecking.value = false
  if (nextMode !== 'agent') agentKey.value = ''
}

watch(username, (value) => {
  usernameAvailability.value = null
  usernameChecking.value = false
  if (usernameCheckTimer) clearTimeout(usernameCheckTimer)
  const sequence = ++usernameCheckSequence
  const candidate = String(value || '').trim()
  if (!candidate || !/^[\p{L}\p{N}_-]{3,32}$/u.test(candidate)) return
  usernameChecking.value = true
  usernameCheckTimer = setTimeout(async () => {
    try {
      const result = await $fetch('/api/auth/username-availability', { query: { username: candidate } })
      if (sequence !== usernameCheckSequence || candidate !== username.value.trim()) return
      usernameAvailability.value = result?.available === true
    } catch {
      if (sequence === usernameCheckSequence) usernameAvailability.value = null
    } finally {
      if (sequence === usernameCheckSequence) usernameChecking.value = false
    }
  }, 300)
})

async function generateUsername() {
  usernameSuggestionPending.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch('/api/auth/username-availability')
    username.value = result.username
    usernameAvailability.value = result.available === true
  } catch (error) {
    errorMessage.value = error?.data?.statusMessage || t('auth.usernameGenerateFailed')
  } finally {
    usernameSuggestionPending.value = false
  }
}

async function submit() {
  pending.value = true
  errorMessage.value = ''
  suggestedUsername.value = ''
  if (mode.value === 'register' && usernameAvailability.value === false) {
    errorMessage.value = t('auth.usernameTaken')
    pending.value = false
    return
  }
  try {
    const endpoint = mode.value === 'agent' ? '/api/auth/agent-key' : mode.value === 'login' ? '/api/auth/login' : '/api/auth/register'
    const payload = mode.value === 'agent'
      ? { key: agentKey.value }
      : mode.value === 'login'
      ? { login: login.value, password: password.value }
      : { username: username.value, email: email.value, password: password.value }
    const response = await $fetch(endpoint, { method: 'POST', body: payload })
    if (mode.value === 'register') suggestedUsername.value = response.actor.username
    password.value = ''
    agentKey.value = ''
    authenticatedActor.value = response.actor
    await navigateTo(redirectAfterLogin.value)
  } catch (error) {
    errorMessage.value = error?.data?.statusMessage || 'The request could not be completed. Please try again.'
  } finally {
    pending.value = false
  }
}

useSeoMeta({ title: () => `${t('auth.accounts')} · AIKI`, robots: 'noindex, nofollow' })
</script>
