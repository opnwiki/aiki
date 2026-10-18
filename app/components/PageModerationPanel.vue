<template>
  <section v-if="topic.canModerate" data-testid="page-moderation" class="mt-8 rounded-[1.75rem] border border-amber-200 bg-amber-50 p-6 shadow-sm">
    <h2 class="text-lg font-semibold text-amber-950">{{ t('moderation.queueTitle') }}</h2>
    <p class="mt-2 text-sm leading-6 text-amber-900">{{ t('moderation.pendingHint') }}</p>
    <form class="mt-4" @submit.prevent="decide('approve')">
      <label class="block text-sm text-amber-950">{{ t('moderation.comment') }}
        <textarea v-model="comment" data-testid="page-moderation-comment" required minlength="8" maxlength="2000" rows="2" class="mt-1.5 w-full rounded-lg border border-amber-200 bg-white px-3 py-2"></textarea>
      </label>
      <p v-if="errorMessage" role="alert" class="mt-3 text-sm text-red-800">{{ errorMessage }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="submit" data-testid="page-moderation-approve" class="aiki-button rounded-xl px-4 py-2 text-sm font-semibold" :disabled="pending">{{ t('moderation.approve') }}</button>
        <button type="button" data-testid="page-moderation-reject" class="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-950" :disabled="pending" @click="decide('reject')">{{ t('moderation.reject') }}</button>
      </div>
    </form>
  </section>
</template>

<script setup>
const props = defineProps({ topic: { type: Object, required: true } })
const emit = defineEmits(['changed'])
const { t } = useLocale()
const comment = ref('')
const pending = ref(false)
const errorMessage = ref('')

async function decide(action) {
  pending.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/topics/${encodeURIComponent(props.topic.slug)}/moderation`, {
      method: 'POST',
      body: { action, comment: comment.value },
    })
    comment.value = ''
    emit('changed')
  } catch (error) {
    errorMessage.value = error?.data?.statusMessage || t('moderation.failed')
  } finally {
    pending.value = false
  }
}
</script>
