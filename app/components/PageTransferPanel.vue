<template>
  <section v-if="visible || notice" data-testid="page-transfer" :class="plain ? 'mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800' : 'mt-8 rounded-[1.75rem] border border-zinc-200/80 bg-white p-5 shadow-sm sm:p-6'">
    <h2 :class="plain ? 'text-sm font-medium text-zinc-800 dark:text-zinc-100' : 'font-serif text-2xl font-medium text-zinc-950'">{{ t('topic.transferTitle') }}</h2>
    <p class="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">{{ t('topic.transferHint') }}</p>

    <ul v-if="people.length" data-testid="page-access-people" class="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
      <li v-for="person in people" :key="person.key" class="flex items-center gap-2 py-2">
        <span class="min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100">{{ person.label }}</span>
        <select
          class="max-w-[9.5rem] shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          :data-testid="person.removable ? 'page-transfer-cancel' : 'page-access-level'"
          :aria-label="t('topic.accessLevelLabel', { name: person.label })"
          :value="person.level"
          @change="changeLevel(person, $event)"
        >
          <option v-if="person.level === 'manages'" value="manages">{{ t('topic.accessLevelManages') }}</option>
          <option v-if="person.level === 'invited'" value="invited">{{ t('topic.accessLevelInvited') }}</option>
          <option v-if="person.removable" value="remove">{{ t('topic.accessRemove') }}</option>
        </select>
      </li>
    </ul>

    <div v-if="offer" data-testid="page-transfer-status">
      <p v-if="offer.note" class="mt-2 text-xs leading-5 text-zinc-600 dark:text-zinc-300">{{ offer.note }}</p>
      <div v-if="offer.canAccept" class="mt-3 flex flex-wrap gap-2">
        <UButton type="button" color="primary" data-testid="page-transfer-accept" :loading="pending" :disabled="pending" @click="decide('accept')">{{ t('topic.transferAccept') }}</UButton>
        <button v-if="offer.canDecline" type="button" data-testid="page-transfer-decline" class="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-100" :disabled="pending" @click="decide('decline')">{{ t('topic.transferDecline') }}</button>
      </div>
    </div>

    <form v-if="canOffer" class="mt-3" @submit.prevent="offerPage">
      <label class="sr-only" for="page-transfer-recipient">{{ t('topic.transferRecipient') }}</label>
      <div class="flex items-center gap-2">
        <input id="page-transfer-recipient" v-model="recipient" required maxlength="254" autocomplete="off" data-testid="page-transfer-recipient" :placeholder="t('topic.transferRecipient')" class="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
        <button type="submit" data-testid="page-transfer-offer" class="grid size-10 shrink-0 place-items-center rounded-xl border border-zinc-200 text-zinc-700 hover:border-emerald-700 hover:text-emerald-900 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100" :aria-label="t('topic.transferOffer')" :disabled="pending">
          <UIcon name="i-lucide-mail" class="size-4" />
        </button>
      </div>
    </form>

    <p v-if="notice" role="status" class="mt-3 text-sm text-emerald-800 dark:text-emerald-200">{{ notice }}</p>
    <p v-if="errorMessage" role="alert" class="mt-3 text-sm text-red-800 dark:text-red-200">{{ errorMessage }}</p>
  </section>
</template>

<script setup>
const props = defineProps({ slug: { type: String, required: true }, plain: { type: Boolean, default: false } })
const emit = defineEmits(['changed', 'available'])
const { t } = useLocale()
const { public: { nodeDomain } } = useRuntimeConfig()
const encoded = computed(() => encodeURIComponent(props.slug))
const { data, refresh } = await useFetch(() => `/api/topics/${encoded.value}/transfer`)
const recipient = ref('')
const pending = ref(false)
const notice = ref('')
const errorMessage = ref('')
const offer = computed(() => data.value?.offer || null)
const canOffer = computed(() => Boolean(data.value?.canOffer))
const visible = computed(() => Boolean(offer.value || canOffer.value))
watch(visible, value => emit('available', value), { immediate: true })

const failures = {
  'Enter an account id, email, or username.': 'topic.transferInvalid',
  'No active account matches that id, email, or username.': 'topic.transferMissing',
  'That account already manages this page.': 'topic.transferSame',
  'This page already has an offer waiting for a reply.': 'topic.transferPending',
  'Only the current steward or a node owner or admin can offer this page.': 'topic.transferForbidden',
  'A note can be at most 500 characters.': 'topic.transferNoteLong',
  'This offer is no longer waiting.': 'topic.transferStale',
  'The page steward changed before this offer was accepted.': 'topic.transferStewardChanged',
  'Only the invited account can accept or decline.': 'topic.transferNotInvited',
  'Only the person who offered it, the current steward, or a node owner or admin can cancel.': 'topic.transferCannotCancel',
}

const people = computed(() => {
  const rows = []
  const steward = data.value?.steward
  if (steward) {
    rows.push({
      key: 'steward',
      label: shown(steward),
      level: 'manages',
      removable: false,
    })
  }
  if (offer.value) {
    rows.push({
      key: 'invited',
      label: shown(offer.value.to),
      level: 'invited',
      removable: Boolean(offer.value.canCancel),
    })
  }
  return rows
})

function shown(person) {
  return person?.displayName || (person?.username ? `${person.username}@${nodeDomain}` : t('topic.activityCommunity'))
}

function failure(error) {
  const message = error?.data?.statusMessage || ''
  const key = failures[message]
  return key ? t(key) : t('topic.transferFailed')
}

function changeLevel(person, event) {
  const value = event.target.value
  event.target.value = person.level
  if (value === 'remove' && person.removable) decide('cancel')
}

async function offerPage() {
  pending.value = true
  notice.value = ''
  errorMessage.value = ''
  try {
    await $fetch(`/api/topics/${encoded.value}/transfer`, {
      method: 'POST',
      body: { recipient: recipient.value },
    })
    recipient.value = ''
    notice.value = t('topic.transferSent')
    await refresh()
    emit('changed')
  } catch (error) {
    errorMessage.value = failure(error)
  } finally {
    pending.value = false
  }
}

async function decide(action) {
  if (!offer.value || pending.value) return
  pending.value = true
  notice.value = ''
  errorMessage.value = ''
  try {
    await $fetch(`/api/topics/${encoded.value}/transfer/${encodeURIComponent(offer.value.id)}`, {
      method: 'POST',
      body: { action },
    })
    notice.value = t(action === 'accept' ? 'topic.transferAccepted' : action === 'decline' ? 'topic.transferDeclined' : 'topic.transferCancelled')
    await refresh()
    emit('changed')
  } catch (error) {
    errorMessage.value = failure(error)
    await refresh()
  } finally {
    pending.value = false
  }
}
</script>
