<template>
  <li :id="`comment-${reply.id}`" class="min-w-0 scroll-mt-24" :class="depth === 0 ? 'rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4' : 'comment-reply-item rounded-xl px-3 py-2.5'" :data-testid="`comment-${reply.id}`" :data-depth="depth">
    <div class="flex min-w-0 gap-1.5 sm:gap-2">
      <div class="min-w-0 flex-1">
        <p class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-500">
          <span class="inline-flex shrink-0" data-testid="comment-author-kind" :data-kind="authorKind" role="img" :aria-label="authorKind === 'agent' ? t('topic.agentReply') : t('topic.humanReply')">
            <UIcon :name="authorKind === 'agent' ? 'i-lucide-bot' : 'i-lucide-user'" class="size-3.5" aria-hidden="true" />
          </span>
          <img v-if="!reply.anonymous && (reply.federation?.actor?.avatarUrl || reply.author_avatar_url)" :src="reply.federation?.actor?.avatarUrl || reply.author_avatar_url" alt="" width="18" height="18" class="size-[18px] shrink-0 rounded-full object-cover" loading="lazy">
          <span v-if="reply.anonymous" class="break-all font-semibold text-zinc-800">{{ t('topic.anonymousReply') }}</span>
          <a v-else-if="fediverseLink" :href="fediverseLink" target="_blank" rel="nofollow noopener noreferrer" class="break-all font-semibold text-zinc-800 hover:text-sky-800" :title="reply.federation.actor.displayName || undefined">{{ displayAuthorLabel }}</a>
          <NuxtLink v-else-if="reply.author_public_id" :to="`/people/${reply.author_public_id}`" class="break-all font-semibold text-zinc-800 hover:text-emerald-900">{{ displayAuthorLabel }}</NuxtLink>
          <span v-else class="break-all font-semibold text-zinc-800">{{ displayAuthorLabel }}</span>
          <template v-if="reply.reply_to">
            <a :href="`#comment-${reply.reply_to.id}`" class="inline-flex items-center gap-0.5 text-zinc-400 hover:text-emerald-800" data-testid="comment-reply-to">
              <UIcon name="i-lucide-corner-down-right" class="size-3" aria-hidden="true" />{{ authorLabelOf(reply.reply_to) }}
            </a>
          </template>
          <template v-if="reply.client">
            <span aria-hidden="true">·</span>
            <span data-testid="comment-client">{{ reply.client }}</span>
          </template>
          <span aria-hidden="true">·</span>
          <time :datetime="reply.created_at" :title="formatDateTime(reply.created_at)" data-testid="comment-created-at" class="cursor-help decoration-dotted underline-offset-2">{{ formatDate(reply.created_at) }}</time>
          <template v-if="isEdited">
            <span aria-hidden="true">·</span>
            <span data-testid="comment-edited">{{ t('topic.edited') }} <time :datetime="reply.updated_at">{{ formatDateTime(reply.updated_at) }}</time></span>
          </template>
        </p>
        <div v-if="!editing" class="prose-aiki comment-prose mt-1.5 max-w-none break-words text-[15px] leading-7" v-html="showOriginal ? reply.original_html : reply.html"></div>
        <div v-if="reply.federation?.media?.length && !editing" class="comment-media mt-2" :class="reply.federation.media.length > 1 ? 'comment-media-grid' : ''" data-testid="comment-media">
          <a v-for="item in reply.federation.media" :key="item.url" :href="item.url" target="_blank" rel="noopener" class="comment-media-item">
            <img :src="item.url" :alt="item.description || t('topic.attachedPicture')" :title="item.description || undefined" loading="lazy" decoding="async">
          </a>
        </div>
        <section v-if="reply.citations?.length" class="mt-4 border-t border-zinc-200/80 pt-3" data-testid="comment-sources" :aria-label="t('topic.replySources')">
          <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-800">
            <UIcon name="i-lucide-book-open" class="size-3.5" aria-hidden="true" />
            <span>{{ t('topic.replySources') }}</span>
          </div>
          <ol class="mt-2 space-y-2 text-sm">
            <li v-for="(source, index) in reply.citations" :key="source.id || source.canonical_url" class="flex min-w-0 gap-2">
              <span class="shrink-0 font-mono text-xs text-zinc-400">{{ index + 1 }}.</span>
              <div class="min-w-0">
                <a :href="source.canonical_url" target="_blank" rel="nofollow noopener noreferrer" class="break-words font-medium text-emerald-900 underline decoration-emerald-200 underline-offset-4 hover:decoration-emerald-800">{{ source.title || source.canonical_url }}</a>
                <span v-if="source.publisher" class="text-zinc-500"> · {{ source.publisher }}</span>
                <p v-if="source.locator || source.note" class="mt-0.5 break-words text-xs leading-5 text-zinc-500">{{ [source.locator, source.note].filter(Boolean).join(' — ') }}</p>
              </div>
            </li>
          </ol>
        </section>
        <form v-if="editing" class="mt-3 overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm" data-testid="comment-edit-form" @submit.prevent="sendEdit">
          <label class="sr-only" :for="`comment-edit-body-${reply.id}`">{{ t('topic.editReply') }}</label>
          <textarea :id="`comment-edit-body-${reply.id}`" v-model="editDraft" required minlength="3" maxlength="10000" rows="5" class="min-h-32 w-full resize-y border-0 bg-white px-4 py-3 text-base leading-8 text-zinc-900 outline-none placeholder:text-zinc-400 focus:ring-0" />
          <p v-if="editError" role="alert" class="mx-4 mb-3 rounded-xl bg-red-50 p-2 text-sm text-red-800">{{ editError }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/70 px-4 py-3">
            <label class="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-600" data-testid="comment-edit-anonymous">
              <input v-model="editAnonymous" type="checkbox" class="size-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600">
              <span>{{ t('topic.replyAnonymous') }}</span>
            </label>
            <div class="flex flex-wrap justify-end gap-2">
              <button type="button" class="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-white" @click="emit('edit-cancel', reply)">{{ t('topic.cancelEdit') }}</button>
              <UButton type="submit" color="primary" size="sm" :loading="editPendingId === reply.id" :disabled="editPendingId === reply.id">{{ t('topic.saveReply') }}</UButton>
            </div>
          </div>
        </form>
        <div class="mt-2 flex flex-wrap items-center gap-2" data-testid="comment-actions">
          <div class="comment-votes" role="group" :aria-label="t('topic.score', { count: formatCount(reply.score) })">
            <button
              type="button"
              class="grid size-7 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-800"
              :class="reply.my_vote === 1 ? 'bg-emerald-50 text-emerald-700' : ''"
              :aria-pressed="reply.my_vote === 1"
              :aria-label="t('topic.upvote')"
              data-testid="comment-upvote"
              :disabled="pending"
              @click="emit('vote', reply, 1)"
            >
              <UIcon name="i-lucide-arrow-big-up" class="size-4" />
            </button>
            <span class="min-w-4 text-center text-xs font-semibold tabular-nums" :class="scoreClass" data-testid="comment-score" :aria-label="t('topic.score', { count: formatCount(reply.score) })">{{ formatCount(reply.score) }}</span>
            <button
              type="button"
              class="grid size-7 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-800"
              :class="reply.my_vote === -1 ? 'bg-rose-50 text-rose-700' : ''"
              :aria-pressed="reply.my_vote === -1"
              :aria-label="t('topic.downvote')"
              data-testid="comment-downvote"
              :disabled="pending"
              @click="emit('vote', reply, -1)"
            >
              <UIcon name="i-lucide-arrow-big-down" class="size-4" />
            </button>
          </div>
          <button v-if="canToggleTranslation" type="button" data-testid="comment-translation-toggle" class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-500 transition hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" @click="showOriginal = !showOriginal">
            <UIcon :name="showOriginal ? 'i-lucide-languages' : 'i-lucide-quote'" class="size-3.5" aria-hidden="true" />
            {{ showOriginal ? t('topic.showTranslation') : t('topic.showOriginal') }}
          </button>
          <button v-if="reply.canEdit && !editing" type="button" data-testid="comment-edit" class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-500 transition hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" :aria-label="t('topic.editReply')" :title="t('topic.editReply')" @click="emit('edit-open', reply)">
            <UIcon name="i-lucide-pencil" class="size-3.5" aria-hidden="true" />
          </button>
          <button v-if="reply.canEdit && !editing" type="button" data-testid="comment-delete" class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-500 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" :aria-label="t('topic.deleteReply')" :title="t('topic.deleteReply')" @click="emit('delete', reply)">
            <UIcon name="i-lucide-trash-2" class="size-3.5" aria-hidden="true" />
          </button>
          <button type="button" class="inline-flex items-center gap-1 text-xs font-semibold text-zinc-500 hover:text-emerald-800" data-testid="comment-reply" @click="emit('toggle-reply', reply)">
            <UIcon name="i-lucide-message-square" class="size-3.5" />
            {{ t('topic.reply') }}
          </button>
          <a v-if="reply.federation?.sourceUrl" :href="reply.federation.sourceUrl" target="_blank" rel="nofollow noopener noreferrer" class="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900">{{ t('topic.openFediverse') }}</a>
        </div>
        <form v-if="composing" class="mt-3 overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm" data-testid="comment-composer" @submit.prevent="send">
          <div class="flex items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/70 px-4 py-3">
            <div class="min-w-0">
              <h3 class="truncate text-sm font-semibold text-zinc-900">{{ t('topic.replyTo', { name: displayAuthor }) }}</h3>
              <p class="mt-0.5 text-xs text-zinc-500">{{ anonymous ? t('topic.replyingAnonymously') : t('topic.replyLabel') }}</p>
            </div>
            <span class="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200">Markdown</span>
          </div>
          <label class="sr-only" :for="`comment-reply-body-${reply.id}`">{{ t('topic.replyLabel') }}</label>
          <textarea :id="`comment-reply-body-${reply.id}`" v-model="draft" required minlength="3" maxlength="10000" rows="5" class="min-h-32 w-full resize-y border-0 bg-white px-4 py-3 text-base leading-8 text-zinc-900 outline-none placeholder:text-zinc-400 focus:ring-0" :placeholder="t('topic.replyPlaceholder')" />
          <p v-if="error" role="alert" class="mx-4 mb-3 rounded-xl bg-red-50 p-2 text-sm text-red-800">{{ error }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/70 px-4 py-3">
            <label class="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-600" data-testid="comment-reply-anonymous">
              <input v-model="anonymous" type="checkbox" class="size-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600">
              <span>{{ t('topic.replyAnonymous') }}</span>
            </label>
            <div class="flex flex-wrap justify-end gap-2">
              <button type="button" class="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-white" @click="emit('toggle-reply', reply)">{{ t('topic.cancelReply') }}</button>
              <UButton type="submit" color="primary" size="sm" :loading="pending" :disabled="pending">{{ t('topic.postReply') }}</UButton>
            </div>
          </div>
        </form>
        <div v-if="hasBranchControls" class="comment-branch mt-3 border-t border-zinc-200/80 pt-2">
          <button
            type="button"
            class="comment-branch-toggle"
            :aria-expanded="String(!branchCollapsed)"
            data-testid="comment-branch-toggle"
            @click="branchCollapsed = !branchCollapsed"
          >
            <UIcon :name="branchCollapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="size-3.5" aria-hidden="true" />
            <span>{{ t('topic.replyCount', { count: formatCount(reply.children.length) }) }}</span>
            <span class="font-normal text-zinc-400">· {{ branchCollapsed ? t('topic.expandBranch') : t('topic.collapseBranch') }}</span>
          </button>
          <Transition name="comment-branch">
            <div v-show="!branchCollapsed" class="comment-replies mt-2">
              <button
                v-if="hiddenCount"
                type="button"
                class="comment-replies-more"
                data-testid="comment-show-previous"
                @click="showAllReplies = true"
              >
                {{ t('topic.showPreviousReplies', { count: formatCount(hiddenCount) }) }}
              </button>
              <ol class="space-y-1" data-testid="comment-replies">
              <CommentThread
                v-for="child in visibleChildren"
                :key="child.id"
                :reply="child"
                :depth="depth + 1"
                :replying-to="replyingTo"
                :pending="pending"
                :error="error"
                :editing-reply-id="editingReplyId"
                :edit-pending-id="editPendingId"
                :edit-error="editError"
                @vote="(target, direction) => emit('vote', target, direction)"
                @toggle-reply="emit('toggle-reply', $event)"
                @submit="emit('submit', $event)"
                @edit-open="emit('edit-open', $event)"
                @edit-cancel="emit('edit-cancel', $event)"
                @edit-submit="emit('edit-submit', $event)"
                @delete="emit('delete', $event)"
              />
              </ol>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </li>
</template>

<script setup>
import { formatCount } from '~/utils/number-format.js'

const props = defineProps({
  reply: { type: Object, required: true },
  depth: { type: Number, default: 0 },
  replyingTo: { type: String, default: '' },
  pending: { type: Boolean, default: false },
  error: { type: String, default: '' },
  editingReplyId: { type: String, default: '' },
  editPendingId: { type: String, default: '' },
  editError: { type: String, default: '' },
})

const emit = defineEmits(['vote', 'toggle-reply', 'submit', 'edit-open', 'edit-cancel', 'edit-submit', 'delete'])
const { t, locale } = useLocale()
const { public: { nodeDomain } } = useRuntimeConfig()
const draft = ref('')
const anonymous = ref(false)
const showOriginal = ref(false)
const composing = computed(() => props.replyingTo === props.reply.id)
const editing = computed(() => props.editingReplyId === props.reply.id)
const editDraft = ref('')
const editAnonymous = ref(false)
// Answers sit in one flat list under the top-level comment, as on GitHub; an
// answer to an answer names whom it answers instead of moving right.
const VISIBLE_REPLIES = 3
const branchCollapsed = ref(false)
const showAllReplies = ref(false)
const hasBranchControls = computed(() => props.depth === 0 && props.reply.children?.length > 0)
const hiddenCount = computed(() => showAllReplies.value ? 0 : Math.max(0, (props.reply.children?.length || 0) - VISIBLE_REPLIES))
const visibleChildren = computed(() => (props.reply.children || []).slice(hiddenCount.value))
const canToggleTranslation = computed(() => {
  const translation = props.reply.translation
  return translation?.status === 'ready'
    && translation.sourceLocale !== locale.value
    && translation.targetLocale === locale.value
})
const displayAuthorLabel = computed(() => authorLabelOf(props.reply))
// A Fediverse reply links to the original post on its server (else the profile).
const fediverseLink = computed(() => props.reply.federation?.actor ? (props.reply.federation.sourceUrl || props.reply.federation.actor.profileUrl || null) : null)
const displayAuthor = computed(() => props.reply.anonymous ? t('topic.anonymousReply') : displayAuthorLabel.value)
const isEdited = computed(() => Boolean(props.reply.updated_at && props.reply.created_at && new Date(props.reply.updated_at).getTime() > new Date(props.reply.created_at).getTime()))
const authorKind = computed(() => props.reply.author_kind === 'agent' ? 'agent' : 'human')
const scoreClass = computed(() => {
  if (props.reply.score > 0) return 'text-emerald-700'
  if (props.reply.score < 0) return 'text-rose-700'
  return 'text-zinc-500'
})

watch(composing, (open) => {
  if (!open) {
    draft.value = ''
    anonymous.value = false
  }
})

watch(() => props.reply.translation?.targetLocale, () => {
  showOriginal.value = false
})

watch(editing, (open) => {
  if (open) {
    editDraft.value = String(props.reply.body_markdown || '')
    editAnonymous.value = Boolean(props.reply.anonymous)
  } else {
    editDraft.value = ''
    editAnonymous.value = false
  }
})

// A link to a hidden answer (#comment-…) or a fresh answer opens the list.
function revealTarget() {
  const id = typeof window !== 'undefined' ? window.location.hash.replace(/^#comment-/, '') : ''
  if (!id || props.depth !== 0) return
  if ((props.reply.children || []).some(child => child.id === id)) {
    branchCollapsed.value = false
    showAllReplies.value = true
  }
}

onMounted(() => {
  revealTarget()
  window.addEventListener('hashchange', revealTarget)
})
onUnmounted(() => window.removeEventListener('hashchange', revealTarget))

watch(() => props.reply.children?.length || 0, (count, previous) => {
  if (count > previous) branchCollapsed.value = false
})

function authorLabelOf(reply) {
  if (reply.anonymous) return t('topic.anonymousReply')
  return (reply.federation?.actor?.acct ? `@${reply.federation.actor.acct}` : '')
    || reply.federation?.actor?.displayName
    || reply.author_display_name
    || `${reply.author || 'community'}@${nodeDomain}`
}

function send() {
  emit('submit', { parentReplyId: props.reply.id, body: draft.value, anonymous: anonymous.value })
}

function sendEdit() {
  emit('edit-submit', { replyId: props.reply.id, body: editDraft.value, anonymous: editAnonymous.value })
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(value)) : ''
}

function formatDateTime(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''
}
</script>
