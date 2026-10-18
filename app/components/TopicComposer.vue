<template>
  <form class="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6" @submit.prevent="submit">
    <h2 class="text-lg font-semibold text-zinc-950">{{ t('composer.title') }}</h2>
    <p class="mt-1 text-sm text-zinc-500">{{ t('composer.description') }}</p>
    <div class="mt-4 grid gap-4 sm:grid-cols-3">
      <label class="text-sm font-medium text-zinc-700 sm:col-span-2">{{ t('composer.titleLabel') }}
        <input v-model="title" required minlength="8" maxlength="180" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" :placeholder="t('home.searchPlaceholder')">
      </label>
      <label class="text-sm font-medium text-zinc-700 sm:col-span-3">{{ t('composer.address') }}
        <input v-model="address" data-testid="page-address" maxlength="96" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 font-mono outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" :placeholder="t('composer.addressPlaceholder')" @input="scheduleAddressCheck">
        <span class="mt-1 block text-xs font-normal text-zinc-500">{{ t('composer.addressHint') }}</span>
        <span v-if="addressNote" data-testid="page-address-note" class="mt-1 block text-xs font-medium" :class="addressFree ? 'text-emerald-800' : 'text-amber-800'">{{ addressNote }}</span>
      </label>
      <label class="text-sm font-medium text-zinc-700">{{ t('composer.type') }}
        <select v-model="kind" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none focus:border-emerald-700">
          <option value="article">{{ t('topics.articles') }}</option>
          <option value="question">{{ t('composer.question') }}</option>
          <option value="discussion">{{ t('composer.discussion') }}</option>
          <option value="message">{{ t('composer.message') }}</option>
        </select>
      </label>
      <label class="text-sm font-medium text-zinc-700">{{ t('composer.contentLanguage') }}
        <select v-model="contentLocale" data-testid="topic-content-locale" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none focus:border-emerald-700">
          <option v-for="language in contentLanguages" :key="language.code" :value="language.code">{{ language.name }}</option>
        </select>
        <span class="mt-1 block text-xs font-normal text-zinc-500">{{ t('composer.contentLanguageHint') }}</span>
      </label>
    </div>
    <div v-if="kind === 'message'" class="mt-4 grid gap-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-sm text-sky-950 sm:grid-cols-2">
      <label class="flex items-center gap-2"><input v-model="acceptReplies" type="checkbox">{{ t('composer.acceptReplies') }}</label>
      <label class="flex items-center gap-2"><input v-model="discussionEnabled" type="checkbox">{{ t('composer.discussionEnabled') }}</label>
    </div>
    <div class="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
      <p v-if="branch" class="text-sm text-zinc-700">{{ t('branches.placedIn', { name: branch.title }) }}</p>
      <template v-else>
        <label class="block text-sm font-medium text-zinc-700">{{ t('branches.pick') }}
          <select v-model="branchChoice" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none focus:border-emerald-700">
            <option value="">{{ t('branches.none') }}</option>
            <option v-for="item in branchOptions" :key="item.slug" :value="item.slug">{{ item.title }}</option>
            <option value="__new__">{{ t('branches.new') }}</option>
          </select>
        </label>
        <div v-if="branchChoice === '__new__'" class="mt-4 grid gap-3">
          <label class="text-sm font-medium text-zinc-700">{{ t('branches.name') }}
            <input v-model="newBranchTitle" required minlength="2" maxlength="80" class="mt-1.5 w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700">
          </label>
          <label class="text-sm font-medium text-zinc-700">{{ t('branches.about') }}
            <textarea v-model="newBranchDescription" maxlength="500" rows="2" class="mt-1.5 w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700"></textarea>
          </label>
        </div>
      </template>
    </div>
    <label class="mt-4 block text-sm font-medium text-zinc-700">{{ t('composer.details') }}
      <textarea v-model="body" required minlength="20" maxlength="40000" rows="5" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" :placeholder="t('composer.detailsPlaceholder')" />
    </label>
    <section class="relative mt-4 rounded-xl border border-zinc-200 bg-white p-4" data-testid="topic-tags">
      <label class="block text-sm font-medium text-zinc-700">{{ t('composer.tags') }}
        <input v-model="tagDraft" data-testid="topic-tags-input" maxlength="48" class="mt-1.5 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" :placeholder="t('composer.tagsPlaceholder')" @input="scheduleTagSuggestions" @keydown.enter.prevent="addTagFromDraft">
      </label>
      <p class="mt-1 text-xs font-normal text-zinc-500">{{ t('composer.tagsHint') }} {{ t('composer.tagsLimit') }}</p>
      <div v-if="tags.length" class="mt-3 flex flex-wrap gap-2">
        <span v-for="tag in tags" :key="tag.slug" class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900">
          #{{ tag.label }}
          <button type="button" class="rounded-full px-1 text-emerald-700 hover:bg-emerald-100" :aria-label="t('composer.removeTag')" @click="removeTag(tag.slug)">×</button>
        </span>
      </div>
      <div v-if="tagSuggestions.length" class="absolute inset-x-4 top-[calc(100%-1rem)] z-10 mt-1 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg" role="listbox">
        <button v-for="suggestion in tagSuggestions" :key="suggestion.slug" type="button" role="option" class="block w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-emerald-50" @click="addTag(suggestion.slug, suggestion.label)">
          #{{ suggestion.label }} <span class="text-xs text-zinc-400">{{ formatCount(suggestion.usage_count) }}</span>
        </button>
      </div>
    </section>
    <label class="mt-4 block text-sm font-medium text-zinc-700">{{ t('composer.overview') }}
      <textarea v-model="overview" maxlength="2000" rows="3" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" :placeholder="t('composer.overviewHint')" />
      <span class="mt-1 block text-xs font-normal text-zinc-500">{{ t('composer.overviewHint') }}</span>
    </label>
    <section v-if="kind === 'article'" class="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
      <h3 class="text-sm font-semibold text-zinc-700">{{ t('composer.provenanceTitle') }}</h3>
      <label class="mt-3 block text-sm text-zinc-700">{{ t('composer.authorshipMode') }}
        <select v-model="authorshipMode" required class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2">
          <option value="human_only">{{ t('topic.authorshipHumanOnly') }}</option>
          <option value="human_ai_collaboration">{{ t('topic.authorshipCollaboration') }}</option>
          <option value="ai_generated_human_reviewed">{{ t('topic.authorshipAIReviewed') }}</option>
          <option value="ai_generated_unreviewed">{{ t('topic.authorshipAIUnreviewed') }}</option>
        </select>
      </label>
      <label v-if="authorshipMode !== 'human_only'" class="mt-3 block text-sm text-zinc-700">{{ t('topic.modelUsed') }}
        <input v-model="modelName" required maxlength="160" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2" placeholder="Provider / model name and version">
      </label>
      <label v-if="authorshipMode === 'human_only' || authorshipMode === 'human_ai_collaboration'" class="mt-3 block text-sm text-zinc-700">{{ t('topic.humanContribution') }}
        <textarea v-model="humanContribution" required maxlength="500" rows="2" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2" :placeholder="t('composer.humanContributionPlaceholder')" />
      </label>
    </section>
    <section v-if="kind === 'article'" class="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-sm font-semibold text-zinc-700">{{ t('topic.sources') }} <span class="text-red-700">*</span></h3>
        <button type="button" class="text-sm font-semibold text-emerald-800 underline" @click="addSource">{{ t('composer.addSource') }}</button>
      </div>
      <p class="mt-1 text-xs text-zinc-500">{{ t('composer.sourcesNote') }}</p>
      <div v-for="(item, index) in sources" :key="index" class="mt-4 grid gap-3 rounded-lg border border-zinc-100 p-3 sm:grid-cols-2">
        <label class="text-sm text-zinc-700 sm:col-span-2">{{ t('composer.publicUrl') }}
          <input v-model="item.url" required type="url" maxlength="2048" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2" placeholder="https://example.org/source">
        </label>
        <label class="text-sm text-zinc-700">{{ t('composer.titleLabel') }}
          <input v-model="item.title" maxlength="240" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2">
        </label>
        <label class="text-sm text-zinc-700">{{ t('composer.publisher') }}
          <input v-model="item.publisher" maxlength="180" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2">
        </label>
        <label class="text-sm text-zinc-700 sm:col-span-2">{{ t('composer.note') }}
          <input v-model="item.locator" maxlength="500" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2">
        </label>
        <button v-if="sources.length > 1" type="button" class="text-left text-xs text-red-700 underline sm:col-span-2" @click="removeSource(index)">{{ t('composer.removeSource') }}</button>
      </div>
    </section>
    <details v-else class="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
      <summary class="cursor-pointer text-sm font-medium text-emerald-800">{{ t('composer.source') }}</summary>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <label class="text-sm text-zinc-700 sm:col-span-2">{{ t('composer.publicUrl') }}
          <input v-model="source.url" type="url" maxlength="2048" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2" placeholder="https://example.org/source">
        </label>
        <label class="text-sm text-zinc-700">{{ t('composer.titleLabel') }}
          <input v-model="source.title" maxlength="240" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2">
        </label>
        <label class="text-sm text-zinc-700">{{ t('composer.publisher') }}
          <input v-model="source.publisher" maxlength="180" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2">
        </label>
        <label class="text-sm text-zinc-700 sm:col-span-2">{{ t('composer.note') }}
          <input v-model="source.locator" maxlength="500" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2">
        </label>
      </div>
    </details>
    <section v-if="kind === 'article'" data-testid="article-rules" class="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
      <h3 class="text-sm font-semibold text-zinc-700">{{ t('rules.title') }}</h3>
      <ul class="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-zinc-600">
        <li v-for="rule in articleRules" :key="rule.id">{{ rule.statement }}</li>
      </ul>
      <label class="mt-3 flex items-start gap-2 text-sm leading-6 text-zinc-800">
        <input v-model="rulesConsent" data-testid="article-rules-consent" type="checkbox" required class="mt-1">
        <span>{{ t('rules.consent') }}</span>
      </label>
    </section>
    <div class="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
      <h3 class="text-sm font-semibold text-zinc-700">{{ t('composer.visibilityTitle') }}</h3>
      <label class="mt-2 flex items-start gap-2 text-sm leading-6 text-zinc-800">
        <input v-model="anonymous" data-testid="topic-anonymous" type="checkbox" class="mt-1" @change="authorVisibilityTouched = true">
        <span>{{ t('composer.anonymous') }}</span>
      </label>
      <p class="mt-2 text-xs leading-5 text-zinc-500">{{ t('composer.authorVisibilityHint') }}</p>
      <div class="mt-2 flex flex-wrap gap-3 text-sm text-zinc-800">
        <label class="flex items-center gap-2"><input v-model="access" type="radio" value="public" data-testid="topic-access-public"><span>{{ t('composer.accessPublic') }}</span></label>
        <label class="flex items-center gap-2"><input v-model="access" type="radio" value="link" data-testid="topic-access-link"><span>{{ t('composer.accessLink') }}</span></label>
      </div>
    </div>
    <p v-if="errorMessage" role="alert" class="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ errorMessage }}</p>
    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p class="max-w-md text-xs leading-5 text-zinc-500"><template v-if="anonymous">{{ t('composer.anonymous') }}</template><template v-else>{{ t('composer.author', { name: actor?.displayName || `${actor?.username}@${nodeDomain}` }) }}</template> <NuxtLink to="/terms" class="font-medium text-emerald-900 underline">{{ t('footer.terms') }}</NuxtLink>. {{ t('composer.termsNote') }}</p>
      <UButton type="submit" color="primary" :loading="pending" :disabled="pending">{{ t('composer.publish') }}</UButton>
    </div>
  </form>
</template>

<script setup>
import { formatCount } from '~/utils/number-format.js'

import { languages } from '~/utils/i18n.js'

const props = defineProps({
  actor: { type: Object, default: null },
  branch: { type: Object, default: null },
})
defineEmits(['created'])
const { public: { nodeDomain } } = useRuntimeConfig()
const { t, locale } = useLocale()
const contentLanguages = languages
const title = ref('')
const address = ref('')
const addressNote = ref('')
const addressFree = ref(false)
let addressTimer = 0
const body = ref('')
const overview = ref('')
const kind = ref('question')
const acceptReplies = ref(true)
const discussionEnabled = ref(true)
const contentLocale = ref(locale.value)
const tagDraft = ref('')
const tags = ref([])
const tagSuggestions = ref([])
let tagTimer = 0
const source = reactive({ url: '', title: '', publisher: '', locator: '', note: '' })
const sources = ref([{ url: '', title: '', publisher: '', locator: '', note: '' }])
const { data: rulePayload } = await useFetch('/api/article-rules', { query: computed(() => ({ locale: locale.value })) })
const articleRules = computed(() => rulePayload.value?.rules || [])
const rulesConsent = ref(false)
const anonymous = ref(false)
const authorVisibilityTouched = ref(false)
const access = ref('public')
const authorshipMode = ref('human_only')
const modelName = ref('')
const humanContribution = ref('')
watch(() => props.actor?.showAuthor, (showAuthor) => {
  if (!authorVisibilityTouched.value) anonymous.value = showAuthor === false
}, { immediate: true })
watch(authorshipMode, (value) => {
  if (value === 'human_only') modelName.value = ''
  if (value !== 'human_ai_collaboration' && value !== 'human_only') humanContribution.value = ''
})
watch(kind, (value) => {
  if (value === 'article' && !['human_only', 'human_ai_collaboration', 'ai_generated_human_reviewed', 'ai_generated_unreviewed'].includes(authorshipMode.value)) authorshipMode.value = 'human_ai_collaboration'
})
function scheduleAddressCheck() {
  addressNote.value = ''
  addressFree.value = false
  clearTimeout(addressTimer)
  const value = address.value.trim()
  if (!value) return
  addressTimer = setTimeout(async () => {
    try {
      const result = await $fetch('/api/page-slugs', { query: { slug: value } })
      if (address.value.trim() !== value) return
      addressFree.value = result.available === true
      addressNote.value = result.available ? t('composer.addressFree') : t(result.reason === 'taken' ? 'composer.addressTaken' : 'composer.addressInvalid')
    } catch {
      addressNote.value = ''
    }
  }, 300)
}
function normalizeTagDraft(value) {
  return String(value || '').normalize('NFKC').replace(/^#+/, '').replace(/\s+/gu, ' ').trim()
}
function tagSlug(value) {
  return normalizeTagDraft(value).toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '')
}
function addTag(value = tagDraft.value, label = value) {
  const slug = tagSlug(value)
  if (!slug || tags.value.length >= 8 || tags.value.some(tag => tag.slug === slug)) return
  tags.value.push({ slug, label: normalizeTagDraft(label).slice(0, 48) || slug })
  tagDraft.value = ''
  tagSuggestions.value = []
}
function addTagFromDraft() {
  addTag(tagDraft.value)
}
function removeTag(slug) {
  tags.value = tags.value.filter(tag => tag.slug !== slug)
}
function scheduleTagSuggestions() {
  clearTimeout(tagTimer)
  const query = normalizeTagDraft(tagDraft.value)
  if (!query) {
    tagSuggestions.value = []
    return
  }
  tagTimer = setTimeout(async () => {
    try {
      const result = await $fetch('/api/tags', { query: { q: query, limit: 8 } })
      tagSuggestions.value = (result.tags || []).filter(tag => !tags.value.some(selected => selected.slug === tag.slug))
    } catch {
      tagSuggestions.value = []
    }
  }, 250)
}
function addSource() {
  if (sources.value.length < 20) sources.value.push({ url: '', title: '', publisher: '', locator: '', note: '' })
}
function removeSource(index) {
  if (sources.value.length > 1) sources.value.splice(index, 1)
}
const branchChoice = ref('')
const newBranchTitle = ref('')
const newBranchDescription = ref('')
const { data: branchList } = props.branch ? { data: ref(null) } : await useFetch('/api/branches', { query: { limit: 50 } })
const branchOptions = computed(() => branchList?.value?.items || [])
const pending = ref(false)
const errorMessage = ref('')
onUnmounted(() => clearTimeout(tagTimer))

async function submit() {
  pending.value = true
  errorMessage.value = ''
  try {
    const payload = {
      title: title.value,
      body: body.value,
      kind: kind.value,
      locale: contentLocale.value || undefined,
      tags: tags.value.map(tag => tag.label),
      ...(kind.value === 'message' ? { acceptReplies: acceptReplies.value, discussionEnabled: discussionEnabled.value } : {}),
    }
    if (address.value.trim()) payload.slug = address.value.trim()
    if (props.branch?.slug) payload.branchSlug = props.branch.slug
    else if (branchChoice.value === '__new__') payload.newBranch = { title: newBranchTitle.value, description: newBranchDescription.value }
    else if (branchChoice.value) payload.branchSlug = branchChoice.value
    Object.assign(payload, {
      access: access.value,
    })
    if (authorVisibilityTouched.value) payload.anonymous = anonymous.value === true
    Object.assign(payload, {
      overview: overview.value,
    })
    if (kind.value === 'article') Object.assign(payload, {
      authorshipMode: authorshipMode.value,
      modelName: modelName.value,
      humanContribution: humanContribution.value,
      sources: sources.value,
      rulesConsent: rulesConsent.value === true,
    })
    else payload.source = source

    const result = await $fetch('/api/topics', {
      method: 'POST',
      body: payload,
    })
    await navigateTo(result.topic.page_number ? `/${result.topic.page_number}` : pagePath(result.topic))
  } catch (error) {
    errorMessage.value = error?.data?.statusMessage || 'The topic could not be published. Please try again.'
  } finally {
    pending.value = false
  }
}
</script>
