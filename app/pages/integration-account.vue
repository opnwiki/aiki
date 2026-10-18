<template>
  <section class="mx-auto max-w-lg rounded-3xl border border-zinc-200 bg-white p-8">
    <BackLink to="/">{{ labels.home }}</BackLink>
    <h1 class="mt-6 text-2xl font-semibold">{{ link?.purpose === 'link' ? labels.linkTitle : labels.loginTitle }}</h1>
    <p class="mt-3 text-sm leading-6 text-zinc-600">{{ labels.explanation }}</p>
    <p v-if="link" class="mt-4 rounded-xl bg-zinc-50 p-4 font-medium">{{ link.account.displayName || link.account.username }} <span class="text-zinc-400">#{{ link.account.publicId }}</span></p>
    <p v-if="link?.purpose === 'link' && !existingActor" class="mt-4 text-sm">{{ labels.signInFirst }} <NuxtLink to="/login?redirect=/integration-account" class="font-medium text-emerald-800 underline">{{ labels.signIn }}</NuxtLink></p>
    <p v-else-if="link?.purpose === 'link'" class="mt-4 text-sm">{{ labels.target }}: {{ existingActor?.display_name || existingActor?.username }}</p>
    <p v-if="error" class="mt-4 text-sm text-red-700" role="alert">{{ error }}</p>
    <button v-if="link" type="button" class="mt-6 w-full rounded-xl bg-emerald-800 px-4 py-3 font-medium text-white disabled:opacity-50" :disabled="pending || (link.purpose === 'link' && !existingActor)" @click="confirm">{{ link.purpose === 'link' ? labels.confirmLink : labels.confirmLogin }}</button>
  </section>
</template>

<script setup>
const { locale } = useLocale()
const labels = computed(() => locale.value === 'ru' ? {
  home: 'Главная', loginTitle: 'Вход через бота', linkTitle: 'Связать аккаунт', explanation: 'Одноразовая ссылка действует пять минут. Подтверди действие кнопкой ниже.', signInFirst: 'Сначала войди в существующий аккаунт, затем снова открой ссылку из бота.', signIn: 'Войти', target: 'Связать с аккаунтом', confirmLink: 'Подтвердить привязку', confirmLogin: 'Войти в этот аккаунт', invalid: 'Ссылка истекла или уже использована.',
} : {
  home: 'Home', loginTitle: 'Sign in through the bot', linkTitle: 'Link your account', explanation: 'This one-time link expires in five minutes. Confirm the action below.', signInFirst: 'First sign in to your existing account, then reopen the link from the bot.', signIn: 'Sign in', target: 'Link to account', confirmLink: 'Confirm account link', confirmLogin: 'Sign in to this account', invalid: 'This link has expired or has already been used.',
})
const link = ref(null)
const token = ref('')
const error = ref('')
const pending = ref(false)
const existingActor = ref(null)
const authenticatedActor = useState('auth-actor', () => null)
useHead({ title: 'AiKi account', meta: [{ name: 'referrer', content: 'no-referrer' }, { name: 'robots', content: 'noindex, nofollow' }] })

onMounted(async () => {
  token.value = new URLSearchParams(window.location.hash.slice(1)).get('token') || ''
  // Remove the secret from browser history before any request. It remains in
  // memory only; reopening a bot link is needed after a separate browser login.
  window.history.replaceState(null, '', window.location.pathname)
  if (!/^[A-Za-z0-9_-]{43}$/.test(token.value)) { error.value = labels.value.invalid; return }
  try {
    const [metadata, me] = await Promise.all([
      $fetch('/api/auth/integration-link', { headers: { 'x-aiki-account-token': token.value } }),
      $fetch('/api/auth/me'),
    ])
    link.value = metadata
    existingActor.value = me.actor
  } catch (failure) { error.value = failure.data?.statusMessage || labels.value.invalid }
})

async function confirm() {
  pending.value = true
  error.value = ''
  try {
    const result = await $fetch('/api/auth/integration-link', { method: 'POST', body: { token: token.value } })
    token.value = ''
    authenticatedActor.value = result.actor
    await navigateTo('/account')
  } catch (failure) { error.value = failure.data?.statusMessage || labels.value.invalid }
  finally { pending.value = false }
}
</script>
