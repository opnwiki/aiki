<template>
  <section v-if="topic.canToggleAssistantCheck" data-testid="assistant-moderation" :class="plain ? 'mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800' : 'mt-8 rounded-[1.75rem] border border-zinc-200/80 bg-white p-6 shadow-sm sm:p-8'">
    <h2 :class="plain ? 'flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100' : 'flex items-center gap-3 font-serif text-2xl font-medium text-zinc-950'">
      {{ t('moderation.assistantTitle') }}
      <span v-if="plain" class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Admin</span>
    </h2>
    <p :class="plain ? 'mt-1 text-xs leading-5 text-zinc-500' : 'mt-2 max-w-3xl text-sm leading-6 text-zinc-600'">{{ t('moderation.assistantHint') }}</p>
    <form class="mt-4 grid gap-3" @submit.prevent="save">
      <label class="flex items-start gap-2 text-sm leading-6 text-zinc-800 dark:text-zinc-100">
        <input v-model="enabled" data-testid="assistant-enabled" type="checkbox" class="mt-1 accent-emerald-700">
        <span>{{ t('moderation.enabled') }}</span>
      </label>
      <p v-if="topic.moderationCheck" data-testid="assistant-check" class="rounded-xl bg-zinc-50 p-3 text-sm leading-6 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{{ topic.moderationCheck.status }}<span v-if="topic.moderationCheck.reason"> — {{ topic.moderationCheck.reason }}</span></p>
      <p v-if="notice" role="status" data-testid="assistant-saved" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{{ notice }}</p>
      <p v-if="errorMessage" role="alert" class="rounded-xl bg-red-50 p-3 text-sm text-red-800">{{ errorMessage }}</p>
      <button type="submit" data-testid="assistant-save" class="aiki-button w-fit rounded-xl px-4 py-2.5 text-sm font-semibold" :disabled="pending">{{ t('moderation.save') }}</button>
    </form>
  </section>
</template>

<script setup>
const props = defineProps({
  topic: { type: Object, required: true },
  plain: { type: Boolean, default: false },
})
const emit = defineEmits(['changed'])
const { t } = useLocale()
const enabled = ref(true)
const pending = ref(false)
const notice = ref('')
const errorMessage = ref('')

watch(() => props.topic.assistantCheck, (value) => {
  enabled.value = value !== false
}, { immediate: true })

async function save() {
  pending.value = true
  notice.value = ''
  errorMessage.value = ''
  try {
    await $fetch(`/api/topics/${encodeURIComponent(props.topic.slug)}/assistant-moderation`, {
      method: 'PATCH',
      body: { enabled: enabled.value === true },
    })
    notice.value = t('moderation.saved')
    emit('changed')
  } catch (error) {
    errorMessage.value = error?.data?.statusMessage || t('moderation.failed')
  } finally {
    pending.value = false
  }
}
</script>
