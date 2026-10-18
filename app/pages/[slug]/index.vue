<template>
  <article v-if="topic" class="topic-stage" :data-topic-kind="topic.kind">
    <div class="topic-lead">
      <div v-if="pending" class="mb-4 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-900" data-testid="topic-locale-loading" aria-live="polite">
        <span class="size-4 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-700" aria-hidden="true"></span>
        {{ t('topic.loading') }}
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <BackLink to="/topics">{{ t('topic.all') }}</BackLink>
        <a class="max-w-full break-words rounded-full border border-zinc-200 bg-white px-3 py-1.5 font-mono text-xs text-zinc-600 transition hover:border-emerald-700 hover:text-emerald-900" :href="canonicalUrl" :aria-label="t('topic.canonicalPath')">
          /{{ slug }}
        </a>
      </div>

      <div class="topic-lead-panels mt-6">
        <details v-if="pageNavigation.length" class="topic-toc-compact rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <summary class="cursor-pointer list-none font-semibold text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
            <span class="flex items-center justify-between gap-3">{{ t('topic.contents') }}<span class="text-xs font-normal text-zinc-500">{{ formatCount(pageNavigation.length) }}</span></span>
          </summary>
          <nav class="mt-3 border-t border-zinc-100 pt-3" :aria-label="t('topic.pageNavigation')">
            <ol class="space-y-1.5 text-sm">
              <li v-for="item in pageNavigation" :key="item.id" :style="item.level ? { paddingLeft: `${(item.level - 2) * 0.7}rem` } : undefined">
                <a :href="`#${item.id}`" class="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 leading-5 text-zinc-600 transition hover:bg-emerald-50 hover:text-emerald-950" @click.prevent="scrollToPageNavigation(item.id, $event)"><span>{{ item.text }}</span><span v-if="item.id === 'article-proposals'" data-testid="open-proposals-badge" class="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold leading-4 text-amber-900">{{ formatCount(topic.open_proposal_count) }}</span></a>
              </li>
            </ol>
          </nav>
        </details>
        <section v-if="topic.summary" class="topic-overview-compact topic-overview-panel md:hidden" :class="{ 'is-expanded': overviewExpanded }" data-testid="topic-overview" @click="toggleOverview">
          <button type="button" class="topic-overview-toggle" data-testid="topic-overview-toggle" :aria-expanded="String(overviewExpanded)" @click.stop="toggleOverview">
            <span class="flex items-center gap-2"><UIcon name="i-lucide-search" class="size-4 text-emerald-700" aria-hidden="true" />{{ t('topic.overview') }}</span>
            <UIcon name="i-lucide-chevron-down" class="topic-overview-chevron" :class="{ 'is-expanded': overviewExpanded }" aria-hidden="true" />
          </button>
          <div class="topic-overview-body">
            <div class="topic-overview-body-inner">
              <p class="text-xs leading-5 text-emerald-900/70 dark:text-emerald-100/70">{{ t('topic.overviewHint') }}</p>
              <p class="topic-overview-copy mt-3 whitespace-pre-line text-sm leading-6 text-zinc-700">{{ topic.summary }}</p>
              <p v-if="topic.summary_updated_at" class="mt-3 text-[11px] leading-5 text-zinc-500" data-testid="topic-overview-updated">
                {{ t('topic.overviewUpdated', { time: formatDateTime(topic.summary_updated_at) }) }}<span v-if="overviewUpdatedBy"> · {{ t('topic.overviewUpdatedBy', { name: overviewUpdatedBy }) }}</span>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>

    <aside v-if="topic.summary" class="topic-overview-desktop topic-overview-panel min-w-0" :class="{ 'is-expanded': overviewExpanded }" aria-labelledby="topic-overview-heading" data-testid="topic-overview-desktop" @click="toggleOverview">
      <button type="button" class="topic-overview-toggle" data-testid="topic-overview-toggle-desktop" :aria-expanded="String(overviewExpanded)" @click.stop="toggleOverview">
        <span class="flex items-center gap-2"><UIcon name="i-lucide-search" class="size-4 text-emerald-700" aria-hidden="true" /><span id="topic-overview-heading">{{ t('topic.overview') }}</span></span>
        <UIcon name="i-lucide-chevron-down" class="topic-overview-chevron" :class="{ 'is-expanded': overviewExpanded }" aria-hidden="true" />
      </button>
      <div class="topic-overview-body">
        <div class="topic-overview-body-inner">
          <p class="text-xs leading-5 text-emerald-900/70 dark:text-emerald-100/70">{{ t('topic.overviewHint') }}</p>
          <p class="topic-overview-copy mt-3 whitespace-pre-line text-sm leading-6 text-zinc-700">{{ topic.summary }}</p>
          <p v-if="topic.summary_updated_at" class="mt-3 text-[11px] leading-5 text-zinc-500" data-testid="topic-overview-updated-desktop">
            {{ t('topic.overviewUpdated', { time: formatDateTime(topic.summary_updated_at) }) }}<span v-if="overviewUpdatedBy"> · {{ t('topic.overviewUpdatedBy', { name: overviewUpdatedBy }) }}</span>
          </p>
        </div>
      </div>
    </aside>

    <div class="topic-main min-w-0">
        <header class="rounded-[1.75rem] border border-zinc-200/80 bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-11">
          <div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center text-xs">
            <span v-if="topic.kind !== 'page'" class="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-950">{{ kindLabel(topic.kind) }}</span>
            <NuxtLink v-if="topic.branch" :to="`/branches/${encodeURIComponent(topic.branch.slug)}`" class="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-700 hover:text-emerald-900">{{ topic.branch.title }}</NuxtLink>
            <span data-testid="page-locale" class="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-600">{{ topic.locale }}</span>
            <span v-if="topic.publicUsefulnessScore != null" data-testid="topic-public-usefulness" class="rounded-full bg-sky-50 px-3 py-1 font-medium text-sky-900" :title="topic.publicUsefulnessReason || t('topic.publicUsefulnessHint')">{{ t('topic.publicUsefulness') }}: {{ Number(topic.publicUsefulnessScore).toFixed(2) }} / 100.00</span>
            <span v-for="tag in topic.tags || []" :key="tag.slug" data-testid="topic-tag" class="rounded-full bg-sky-50 px-3 py-1 font-medium text-sky-900">#{{ tag.label || tag.slug }}</span>
            <button ref="revisionHistoryTrigger" type="button" data-testid="revision-history-open" class="text-zinc-500 underline-offset-2 hover:text-emerald-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" aria-haspopup="dialog" :aria-expanded="revisionHistoryOpen" @click="revisionHistoryOpen = true">{{ revisionLabel }}</button>
            <span v-if="topic.page_number" data-testid="page-number" class="font-mono text-zinc-500">{{ t('topic.pageNumber', { number: topic.page_number }) }}</span>
          </div>

          <p v-if="topic.access && topic.access !== 'public'" class="mt-4">
            <span class="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">{{ t(`topic.access.${topic.access}`) }}</span>
          </p>

          <h1 class="mt-6 max-w-4xl text-center text-balance font-serif font-medium tracking-tight text-zinc-950 [overflow-wrap:anywhere]" :class="titleSizeClass">{{ topic.title }}</h1>
          <div v-if="topic.sourceTopic" class="mx-auto mt-5 max-w-2xl rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-left text-sm text-sky-950 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-100" data-testid="topic-source-chain">
            <span class="font-semibold">{{ t('topic.sourcePage') }}:</span>
            <NuxtLink :to="topic.sourceTopic.pageNumber ? `/${topic.sourceTopic.pageNumber}` : `/${encodeURIComponent(topic.sourceTopic.slug)}`" class="ml-1 underline decoration-sky-300 underline-offset-2 hover:text-sky-700 dark:decoration-sky-700 dark:hover:text-sky-200">
              {{ topic.sourceTopic.title || topic.sourceTopic.slug }}
            </NuxtLink>
            <span v-if="topic.sourceTopic.kind" class="ml-1 text-sky-800/70 dark:text-sky-200/70">({{ kindLabel(topic.sourceTopic.kind) }})</span>
          </div>
          <div v-if="topic.federation?.importUrl" class="mx-auto mt-5 max-w-2xl rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-left text-sm text-sky-950 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-100" data-testid="topic-federation-source">
            <span class="font-semibold">{{ t('topic.federationSource') }}:</span>
            <a :href="topic.federation.importUrl" target="_blank" rel="nofollow noopener noreferrer" class="ml-1 underline decoration-sky-300 underline-offset-2 hover:text-sky-700 dark:decoration-sky-700 dark:hover:text-sky-200">{{ topic.federation.importUrl }}</a>
            <span v-if="topic.federation.publicImported" class="ml-1 text-sky-800/70 dark:text-sky-200/70">· {{ t('topic.federationImportedCount', { count: topic.federation.publicImported }) }}</span>
          </div>
          <p v-if="topic.translation?.status === 'ready'" data-testid="translation-note" class="mx-auto mt-4 max-w-3xl text-center text-sm leading-6 text-zinc-600">{{ t(topic.translation.humanAdjusted ? 'topic.translationAdjusted' : 'topic.translationMachine', { language: topic.translation.sourceLocale }) }}</p>
          <div v-if="topic.import" data-testid="topic-import-source" class="mx-auto mt-5 max-w-2xl rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-left text-sm leading-6 text-sky-950 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-100">
            <p><span class="font-semibold">{{ t('topic.importSource') }}:</span> <a v-if="topic.import.sourceUrl" :href="topic.import.sourceUrl" target="_blank" rel="nofollow noopener noreferrer" class="break-words underline underline-offset-2">{{ topic.import.sourceTitle || topic.import.sourceUrl }}</a><span v-else class="ml-1">{{ t('topic.importSentText') }}</span></p>
            <p v-if="topic.import.publisher || topic.import.publishedAt" class="text-sky-800/80 dark:text-sky-200/80"><span v-if="topic.import.publisher">{{ topic.import.publisher }}</span><span v-if="topic.import.publisher && topic.import.publishedAt"> · </span><time v-if="topic.import.publishedAt" :datetime="topic.import.publishedAt">{{ formatDateTime(topic.import.publishedAt) }}</time></p>
            <p v-if="topic.import.authorSignature">{{ t('topic.importSignature') }}: {{ topic.import.authorSignature }}</p>
            <p>{{ t('topic.importFormatting') }}<span v-if="topic.import.formatting?.model"> · {{ topic.import.formatting.model }}</span></p>
            <p v-if="topic.import.editedLocally" class="mt-1 text-sky-800/80 dark:text-sky-200/80">{{ t('topic.importChanged') }}</p>
          </div>
          <div class="mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-zinc-100 pt-5 text-center text-sm text-zinc-600">
            <img v-if="!topic.hideAuthor && authorAvatarUrl" :src="authorAvatarUrl" alt="" class="size-8 rounded-full object-cover" loading="lazy" referrerpolicy="no-referrer" />
            <a v-if="!topic.hideAuthor && fediverseAuthorLink" :href="fediverseAuthorLink" target="_blank" rel="nofollow noopener noreferrer" data-testid="topic-author" class="min-w-0 break-all font-semibold text-zinc-900 hover:text-emerald-900" :title="topic.federation.actor.displayName || undefined">{{ displayedAuthor }}</a>
            <NuxtLink v-else-if="!topic.hideAuthor && topic.import?.author?.publicId" :to="`/people/${topic.import.author.publicId}`" data-testid="topic-author" class="min-w-0 break-all font-semibold text-zinc-900 hover:text-emerald-900">{{ displayedAuthor }}</NuxtLink>
            <NuxtLink v-else-if="!topic.hideAuthor && topic.author_public_id" :to="`/people/${topic.author_public_id}`" data-testid="topic-author" class="min-w-0 break-all font-semibold text-zinc-900 hover:text-emerald-900">{{ displayedAuthor }}</NuxtLink>
            <span v-else-if="!topic.hideAuthor" data-testid="topic-author" class="min-w-0 break-all font-semibold text-zinc-900">{{ displayedAuthor }}</span>
            <button v-if="showPageSettings" type="button" data-testid="page-settings" class="grid size-8 place-items-center rounded-full border border-zinc-200 text-zinc-600 hover:border-emerald-700 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" :aria-expanded="settingsOpen" aria-haspopup="dialog" :aria-label="t('topic.pageSettings')" @click="settingsOpen = true">
              <UIcon name="i-lucide-settings" class="size-4" />
            </button>
            <span v-if="topic.created_at" class="inline-flex items-center gap-1">
              <span class="sr-only">{{ t('topic.published') }}: </span>
              <time data-testid="topic-published" :datetime="topic.created_at">{{ t('topic.published') }} {{ formatDateTime(topic.created_at) }}</time>
            </span>
            <span>{{ t('topic.readsCount', { count: formatCount(topic.reads) }) }}</span>
          </div>

          <div class="mt-5 flex flex-wrap items-center justify-center gap-2" data-testid="topic-vote-controls">
            <button
              type="button"
              data-testid="topic-upvote"
              class="grid size-9 place-items-center rounded-md border border-zinc-200 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
              :class="topic.my_vote === 1 ? 'bg-emerald-50 text-emerald-700' : 'text-zinc-700'"
              :aria-pressed="topic.my_vote === 1"
              :aria-label="t('topic.upvote')"
              :title="t('topic.upvote')"
              :disabled="topicVotePending"
              @click="voteOnTopic(1)"
            ><UIcon name="i-lucide-arrow-big-up" class="size-5" aria-hidden="true" /></button>
            <span class="min-w-16 text-center text-sm font-medium text-zinc-600" data-testid="topic-score">{{ t('topic.score', { count: formatCount(topic.score || 0) }) }}</span>
            <button
              type="button"
              data-testid="topic-downvote"
              class="grid size-9 place-items-center rounded-md border border-zinc-200 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
              :class="topic.my_vote === -1 ? 'bg-rose-50 text-rose-700' : 'text-zinc-700'"
              :aria-pressed="topic.my_vote === -1"
              :aria-label="t('topic.downvote')"
              :title="t('topic.downvote')"
              :disabled="topicVotePending"
              @click="voteOnTopic(-1)"
            ><UIcon name="i-lucide-arrow-big-down" class="size-5" aria-hidden="true" /></button>
          </div>
          <p v-if="topicVoteError" class="mt-2 text-center text-sm text-red-800" role="alert">{{ topicVoteError }}</p>

          <div v-if="topic.authorship_mode && !topic.hideAuthor" class="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-left sm:p-5" data-testid="authorship-disclosure">
            <div class="flex items-center justify-start gap-3 text-left">
              <span class="grid size-8 shrink-0 place-items-center rounded-full bg-white text-emerald-900" aria-hidden="true">✳</span>
              <div class="min-w-0 text-sm leading-6">
                <p class="font-semibold text-emerald-950">{{ authorshipDisplayLabel }}</p>
                <p v-if="topic.model_name" class="mt-1 text-zinc-700"><span class="font-medium">{{ t('topic.modelUsed') }}:</span> {{ topic.model_name }}</p>
                <p v-if="topic.human_contribution" class="mt-1 text-zinc-700"><span class="font-medium">{{ t('topic.humanContribution') }}:</span> {{ topic.human_contribution }}</p>
              </div>
            </div>
          </div>
          <div v-if="topic.kind === 'page' && topic.pageClassification" class="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm text-indigo-950 dark:border-indigo-400/40 dark:bg-indigo-950/40 dark:text-indigo-100" data-testid="page-classification-status" role="status" aria-live="polite">
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">{{ topic.pageClassification.status === 'failed' ? t('topic.classificationFailedTitle') : t('topic.classifyingPage') }}</span>
              <span v-if="topic.pageClassification.status !== 'failed'" class="font-mono text-xs">{{ topic.pageClassification.progressPercent }}%</span>
            </div>
            <div v-if="['queued', 'submitted'].includes(topic.pageClassification.status)" class="mt-2 h-1.5 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-900/70">
              <div class="h-full rounded-full bg-indigo-600 transition-all dark:bg-indigo-400" :style="{ width: `${topic.pageClassification.progressPercent}%` }"></div>
            </div>
            <template v-if="topic.pageClassification.status === 'failed'">
              <p class="mt-2 text-sm text-amber-900 dark:text-amber-200">{{ t('topic.classificationFailed') }}</p>
              <button v-if="actor" type="button" data-testid="page-classification-retry" class="mt-3 inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-sm font-semibold text-indigo-950 transition hover:border-indigo-400 disabled:opacity-60" :disabled="classificationRetryPending" @click="retryClassification">
                <UIcon name="i-lucide-refresh-cw" class="size-4" :class="classificationRetryPending ? 'animate-spin' : ''" aria-hidden="true" />{{ t('topic.classificationRetry') }}
              </button>
              <p v-if="classificationRetryError" role="alert" class="mt-2 text-sm text-red-800">{{ classificationRetryError }}</p>
            </template>
          </div>
          <div v-if="topic" class="mt-6 flex justify-center">
            <button type="button" data-testid="ai-explanation-open" class="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-center text-sm font-semibold text-emerald-950 shadow-sm transition hover:border-emerald-500 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" @click="openAiRequest">
              <UIcon name="i-lucide-sparkles" class="size-4" aria-hidden="true" />
              {{ t('topic.requestAiExplanation') }}
            </button>
          </div>
        </header>

        <AppModal
          :open="settingsOpen"
          :title="t('topic.pageSettings')"
          :close-label="t('topic.reportClose')"
          @close="settingsOpen = false"
        >
          <div data-testid="page-settings-panel" class="space-y-5 text-left">
            <button v-if="topic.canEdit" type="button" data-testid="page-edit-open" class="flex w-full items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-left text-sm font-semibold text-emerald-950 transition hover:border-emerald-400 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" @click="openEditPage">
              <UIcon name="i-lucide-pencil" class="size-4" aria-hidden="true" />
              {{ t('topic.editPage') }}
            </button>
            <div v-if="showAccess" data-testid="page-access">
              <p class="text-sm font-medium text-zinc-800 dark:text-zinc-100">{{ t('topic.settingsAccess') }}</p>
              <p class="mt-1 text-xs text-zinc-500">{{ t(`topic.access.${topic.access}`) }}</p>
              <label v-if="topic.canChangeAccess" class="mt-2 block text-sm text-zinc-600">
                <span class="sr-only">{{ t('topic.accessLabel') }}</span>
                <select data-testid="page-access-choice" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-800" :value="topic.access" :disabled="accessPending" @change="setAccess">
                  <option v-for="choice in topic.accessChoices" :key="choice" :value="choice">{{ t(`topic.access.${choice}`) }}</option>
                </select>
              </label>
              <p v-if="accessError" role="alert" class="mt-2 text-sm text-amber-800">{{ accessError }}</p>
            </div>
            <label v-if="topic.canHideAuthor" class="grid gap-1 text-sm text-zinc-700 dark:text-zinc-200">
              <span class="font-medium">{{ t('topic.authorVisibility') }}</span>
              <select data-testid="page-author-visibility" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" :value="topic.authorVisibility || 'profile'" :disabled="authorPending" @change="setAuthorVisibility">
                <option value="profile">{{ t('topic.authorVisibilityProfile') }}</option>
                <option value="show">{{ t('topic.authorVisibilityShow') }}</option>
                <option value="hide">{{ t('topic.authorVisibilityHide') }}</option>
              </select>
              <span class="mt-1 block text-xs leading-5 text-zinc-500">{{ t('topic.authorVisibilityHint') }}</span>
            </label>
            <p v-if="authorError" role="alert" class="text-sm text-amber-800">{{ authorError }}</p>
              <div v-if="topic.kind === 'message' && topic.canEdit" data-testid="message-discussion-settings" class="space-y-3 rounded-xl border border-sky-200 bg-sky-50/60 p-3">
                <p class="text-sm font-medium text-sky-950">{{ t('topic.messageSettings') }}</p>
                <label class="flex items-center gap-2 text-sm text-sky-950"><input data-setting="acceptReplies" type="checkbox" :checked="topic.acceptReplies !== false" :disabled="discussionPending" @change="setDiscussionSettings">{{ t('composer.acceptReplies') }}</label>
                <label class="flex items-center gap-2 text-sm text-sky-950"><input data-setting="discussionEnabled" type="checkbox" :checked="topic.discussionEnabled !== false" :disabled="discussionPending" @change="setDiscussionSettings">{{ t('composer.discussionEnabled') }}</label>
                <label class="grid gap-1 text-sm text-sky-950"><span>{{ t('topic.messageOutbound') }}</span><select data-setting="federationOutboundMode" class="rounded-lg border border-sky-200 bg-white px-2 py-2" :value="topic.federationOutboundMode || 'auto'" :disabled="discussionPending" @change="setDiscussionSettings"><option value="none">none</option><option value="auto">auto</option><option value="manual">manual</option></select></label>
                <p v-if="discussionError" role="alert" class="text-sm text-amber-800">{{ discussionError }}</p>
              </div>
            <PageTransferPanel plain :slug="slug" @changed="onManaged" @available="transferAvailable = $event" />
            <AssistantModerationPanel plain :topic="topic" @changed="refresh" />
          </div>
        </AppModal>

        <AppModal
          :open="aiRequestOpen"
          :title="t('topic.aiRequestTitle')"
          :description="t('topic.aiRequestDescription')"
          :close-label="t('topic.reportClose')"
          @close="closeAiRequest"
        >
          <div class="space-y-5" data-testid="ai-request-panel">
            <div v-if="!aiRequest || ['failed', 'cancelled'].includes(aiRequest.status)" class="space-y-4">
              <fieldset>
                <legend class="text-sm font-semibold text-zinc-900">{{ t('topic.aiRequestChoose') }}</legend>
                <div class="mt-3 grid gap-2">
                  <label v-for="option in aiRequestOptions" :key="option.value" class="flex cursor-pointer gap-3 rounded-xl border p-3 transition" :class="aiRequestType === option.value ? 'border-emerald-500 bg-emerald-50' : 'border-zinc-200 hover:border-emerald-300'">
                    <input v-model="aiRequestType" type="radio" name="topic-ai-request-type" :value="option.value" class="mt-1 accent-emerald-700">
                    <span>
                      <span class="block text-sm font-semibold text-zinc-900">{{ t(option.label) }}</span>
                      <span class="mt-0.5 block text-xs leading-5 text-zinc-600">{{ t(option.description) }}</span>
                    </span>
                  </label>
                </div>
              </fieldset>
              <label class="block text-sm text-zinc-700">{{ t('topic.aiRequestInstruction') }}
                <textarea v-model="aiRequestInstruction" maxlength="1000" rows="3" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" :placeholder="t('topic.aiRequestInstructionPlaceholder')" />
              </label>
              <p class="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">{{ t('topic.aiRequestReviewNote') }}</p>
              <p class="text-sm font-medium text-zinc-700" data-testid="ai-request-price">{{ t('topic.aiRequestPrice') }}</p>
              <p v-if="aiRequestError" role="alert" class="rounded-xl bg-red-50 p-3 text-sm text-red-800">{{ aiRequestError }}</p>
              <div class="flex justify-end">
                <UButton type="button" color="primary" :loading="aiRequestPending" :disabled="aiRequestPending" data-testid="ai-request-submit" @click="submitAiRequest">{{ t('topic.aiRequestStart') }}</UButton>
              </div>
            </div>

            <div v-else-if="['queued', 'submitted'].includes(aiRequest.status)" class="space-y-4" data-testid="ai-request-progress" aria-live="polite">
              <div class="flex items-center justify-between text-sm font-semibold text-zinc-800"><span>{{ t('topic.aiRequestWorking') }}</span><span>{{ aiRequest.progressPercent }}%</span></div>
              <div class="h-2 overflow-hidden rounded-full bg-zinc-100"><div class="h-full rounded-full bg-emerald-600 transition-all" :style="{ width: `${Math.max(4, aiRequest.progressPercent)}%` }"></div></div>
              <p class="text-sm leading-6 text-zinc-600">{{ aiRequest.progressMessage || t('topic.aiRequestWorkingHint') }}</p>
            </div>

            <div v-else-if="aiRequest.status === 'completed' && aiRequest.result" class="space-y-4" data-testid="ai-request-result">
              <p v-if="aiRequest.requestType === 'discussion_reply' && aiRequest.result.publishedReply" class="rounded-xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-950" data-testid="ai-request-published" aria-live="polite">
                {{ t('topic.aiRequestPublished', { name: aiRequest.result.publishedReply.displayName || aiRequest.result.publishedReply.author || 'Neron Agent', model: aiRequest.result.publishedReply.model || 'Neron Agent' }) }}
              </p>
              <p v-else-if="aiRequest.requestType === 'research' && aiRequest.result.publishedRevision" class="rounded-xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-950" data-testid="ai-request-revision-published" aria-live="polite">
                {{ t('topic.aiRequestRevisionPublished', { name: aiRequest.result.publishedRevision.displayName || aiRequest.result.publishedRevision.author || 'Neron Agent', model: aiRequest.result.publishedRevision.model || 'Neron Agent' }) }}
              </p>
              <p v-else-if="aiRequest.requestType === 'overview' && aiRequest.result.updatedOverview" class="rounded-xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-950" data-testid="ai-request-overview-updated" aria-live="polite">
                {{ t('topic.aiRequestOverviewUpdated', { name: aiRequest.result.updatedOverview.displayName || aiRequest.result.updatedOverview.author || 'Neron Agent', model: aiRequest.result.updatedOverview.model || 'Neron Agent' }) }}
              </p>
              <p v-else class="rounded-xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">{{ t('topic.aiRequestCompleted') }}</p>
              <div v-if="aiRequest.result.proposedBody" class="space-y-3">
                <h3 class="font-semibold text-zinc-900">{{ t('topic.aiRequestProposalPreview') }}</h3>
                <pre class="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-950 p-4 text-sm leading-6 text-zinc-100">{{ aiRequest.result.proposedBody }}</pre>
                <p class="rounded-xl bg-zinc-50 p-3 text-sm leading-6 text-zinc-700"><strong>{{ t('topic.rationale') }}:</strong> {{ aiRequest.result.rationale }}</p>
              </div>
              <div v-else-if="aiRequest.result.answer" class="rounded-xl bg-zinc-50 p-4 text-sm leading-7 text-zinc-800 whitespace-pre-line">{{ aiRequest.result.answer }}</div>
              <div v-else-if="aiRequest.result.overview" class="rounded-xl bg-zinc-50 p-4 text-sm leading-7 text-zinc-800 whitespace-pre-line">{{ aiRequest.result.overview }}</div>
              <div v-if="aiRequest.result.sources?.length" class="rounded-xl border border-zinc-200 p-4">
                <h3 class="text-sm font-semibold text-zinc-900">{{ t('topic.sources') }}</h3>
                <ul class="mt-2 space-y-1 text-sm text-emerald-900"><li v-for="source in aiRequest.result.sources" :key="source.url"><a :href="source.url" target="_blank" rel="nofollow noopener noreferrer" class="underline">{{ source.title || source.url }}</a></li></ul>
              </div>
              <div class="flex flex-wrap justify-end gap-2">
                <UButton v-if="aiRequest.result.proposedBody && !aiRequest.result.publishedProposal && !aiRequest.result.publishedRevision" type="button" color="primary" data-testid="ai-request-use-proposal" @click="useAiSupplement">{{ t('topic.aiRequestUseProposal') }}</UButton>
                <UButton v-else-if="aiRequest.requestType !== 'overview' && !aiRequest.result.publishedReply && !aiRequest.result.publishedProposal && !aiRequest.result.publishedRevision" type="button" color="primary" data-testid="ai-request-use-answer" @click="useAiAnswer">{{ t('topic.aiRequestUseAnswer') }}</UButton>
                <UButton v-else type="button" color="primary" data-testid="ai-request-close-published" @click="closeAiRequest">{{ t('topic.aiRequestViewDiscussion') }}</UButton>
              </div>
            </div>

            <div v-else class="space-y-4">
              <p role="alert" class="rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-800">{{ aiRequest.errorMessage || t('topic.aiRequestFailed') }}</p>
              <div class="flex justify-end"><UButton type="button" color="primary" @click="resetAiRequest">{{ t('topic.aiRequestTryAgain') }}</UButton></div>
            </div>
          </div>
        </AppModal>

        <PageModerationPanel :topic="topic" @changed="refresh" />

        <div v-if="selectionText && topic.kind === 'article'" class="fixed z-40 flex items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1.5 text-xs shadow-xl dark:border-zinc-700 dark:bg-zinc-900" :style="selectionToolbarStyle" data-testid="article-selection-tools" @mousedown.prevent>
          <button type="button" data-testid="selection-ask" class="rounded-lg px-3 py-2 font-semibold text-zinc-800 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:text-zinc-100" @click="askAboutSelection">{{ t('topic.askAboutSelection') }}</button>
          <button type="button" data-testid="selection-propose" class="rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" @click="proposeSelection">{{ t('topic.proposeSelection') }}</button>
        </div>

        <section id="article-content" ref="articleContent" class="article-reading mt-8 rounded-[1.75rem] border border-zinc-200/80 bg-white px-6 py-7 shadow-sm sm:px-10 sm:py-10" :aria-label="t('topic.articleText')" @mouseup="captureArticleSelection" @touchend="captureArticleSelection">
          <div class="prose-aiki max-w-none text-[1.075rem] leading-[1.9] text-zinc-800" v-html="topic.html"></div>
        </section>

        <div class="mt-8 md:hidden">
          <nav class="rounded-[1.5rem] border border-zinc-200/80 bg-white p-5 shadow-sm" :aria-label="t('topic.pageNavigation')">
            <h2 class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{{ t('topic.contents') }}</h2>
            <ol class="mt-4 space-y-1.5 text-sm">
              <li v-for="item in pageNavigation" :key="item.id" :style="item.level ? { paddingLeft: `${(item.level - 2) * 0.7}rem` } : undefined">
                <a :href="`#${item.id}`" class="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 leading-5 text-zinc-600 transition hover:bg-emerald-50 hover:text-emerald-950" @click.prevent="scrollToPageNavigation(item.id, $event)"><span>{{ item.text }}</span><span v-if="item.id === 'article-proposals'" data-testid="open-proposals-badge" class="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold leading-4 text-amber-900">{{ formatCount(topic.open_proposal_count) }}</span></a>
              </li>
            </ol>
          </nav>
        </div>

        <section v-if="topic.citations?.length" id="article-sources" class="mt-8 scroll-mt-24 rounded-[1.75rem] border border-zinc-200/80 bg-white p-6 shadow-sm sm:p-8">
          <div class="flex items-end justify-between gap-4 border-b border-zinc-100 pb-4">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800">AIKI · {{ topic.locale }}</p>
              <h2 class="mt-2 font-serif text-2xl font-medium text-zinc-950">{{ t('topic.sources') }}</h2>
            </div>
            <span class="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">{{ formatCount(topic.citations.length) }}</span>
          </div>
          <p v-if="!topic.citations.length" class="mt-4 text-sm text-zinc-500">{{ t('topic.noSources') }}</p>
          <ol v-else class="mt-2 divide-y divide-zinc-100">
            <li v-for="item in displayedSources" :key="item.source.id" class="flex gap-4 py-4 last:pb-1">
              <span class="mt-0.5 font-mono text-xs text-zinc-400">{{ String(item.index + 1).padStart(2, '0') }}</span>
              <div class="min-w-0">
                <a :href="item.source.canonical_url" target="_blank" rel="nofollow noopener noreferrer" class="break-words font-semibold text-emerald-900 underline decoration-emerald-200 underline-offset-4 hover:decoration-emerald-800">{{ item.source.title || item.source.canonical_url }}</a>
                <p v-if="item.source.publisher" class="mt-1 text-xs text-zinc-500">{{ item.source.publisher }}</p>
                <p v-if="item.source.published_at" class="mt-1 text-xs text-zinc-400">{{ t('topic.publishedOn') }} {{ item.source.published_at }}</p>
                <p v-if="item.source.locator || item.source.note" class="mt-2 text-sm leading-6 text-zinc-600">{{ [item.source.locator, item.source.note].filter(Boolean).join(' — ') }}</p>
              </div>
            </li>
          </ol>
          <button
            v-if="hiddenSourceCount"
            type="button"
            class="mt-3 inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            :aria-expanded="sourcesExpanded"
            @click="sourcesExpanded = !sourcesExpanded"
          >
            <span aria-hidden="true" class="text-base leading-none">{{ sourcesExpanded ? '−' : '+' }}</span>
            {{ sourcesExpanded ? t('topic.hideRemaining') : t('topic.showRemaining', { count: hiddenSourceCount }) }}
          </button>
        </section>

        <RevisionHistoryPanel
          :topic="topic"
          :open="revisionHistoryOpen"
          :show-sidebar="['article', 'question', 'discussion', 'message'].includes(topic.kind)"
          @close="closeRevisionHistory"
        >
            <EditProposalPanel v-if="['article', 'question', 'discussion', 'message'].includes(topic.kind)" :key="proposalRefreshKey" :topic="topic" :actor="actor" :overview-only="topic.kind !== 'article'" />
        </RevisionHistoryPanel>
        <PendingTaskSolutions :slug="slug" @accepted="onTaskSolutionAccepted" />
        <PageActivityLog :slug="slug" :tick="activityTick" />

        <section id="article-discussion" class="mt-8 scroll-mt-24 rounded-[1.75rem] border border-zinc-200/80 bg-white p-6 shadow-sm sm:p-8">
          <div class="flex items-end justify-between gap-4 border-b border-zinc-100 pb-4">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800">AIKI · {{ topic.locale }}</p>
              <h2 class="mt-2 font-serif text-2xl font-medium text-zinc-950">{{ t('topic.discussion') }}</h2>
            </div>
            <span class="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">{{ formatCount(topic.reply_count) }}</span>
          </div>
          <div v-if="threads.length > 1" class="mt-4 flex justify-end">
            <div class="comment-sort" role="group" :aria-label="t('topic.commentSort')" data-testid="comment-sort">
              <button
                v-for="option in COMMENT_SORTS"
                :key="option"
                type="button"
                :aria-pressed="commentSort === option"
                :data-testid="`comment-sort-${option}`"
                @click="setCommentSort(option)"
              >
                {{ t(`topic.commentSort.${option}`) }}
              </button>
            </div>
          </div>
          <p v-if="topic.replies_has_more" class="mt-4 text-sm text-zinc-500">{{ t('topic.replyMore', { count: formatCount(topic.reply_count - topic.replies.length) }) }}</p>
          <div v-if="threads.length" class="comment-tree" data-testid="comment-tree">
            <ol class="mt-5 space-y-4" data-testid="comment-list">
              <CommentThread
                v-for="reply in threads"
                :key="reply.id"
                :reply="reply"
                :replying-to="replyingTo"
                :pending="replyPending || Boolean(votePendingId)"
                :error="replyError"
                :editing-reply-id="editingReplyId"
                :edit-pending-id="replyEditPendingId"
                :edit-error="replyEditError"
                @vote="voteOnReply"
                @toggle-reply="toggleReply"
                @submit="submitReply"
                @edit-open="openReplyEdit"
                @edit-cancel="cancelReplyEdit"
                @edit-submit="submitReplyEdit"
                @delete="requestReplyDelete"
              />
            </ol>
          </div>
          <UButton v-if="topic.replies_has_more" type="button" color="neutral" variant="outline" class="mt-5" :loading="replyMorePending" :disabled="replyMorePending" data-testid="load-more-replies" @click="loadMoreReplies">
            {{ replyMorePending ? t('topic.replyLoadingMore') : t('topic.replyLoadMore') }}
          </UButton>
          <p v-if="replyMoreError" class="mt-2 text-sm text-red-800" role="alert">{{ replyMoreError }}</p>
          <p v-if="!threads.length" class="mt-4 text-sm text-zinc-500">{{ t('topic.noReplies') }}</p>

          <form v-if="actor" class="mt-8 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm" @submit.prevent="submitReply()">
            <div class="flex items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/70 px-5 py-4 sm:px-6">
              <div class="flex min-w-0 items-center gap-3">
                <span class="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-800" aria-hidden="true"><UIcon name="i-lucide-user" class="size-4" /></span>
                <div class="min-w-0">
                  <h3 class="font-semibold text-zinc-900">{{ t('topic.addReply') }}</h3>
                  <p class="truncate text-xs text-zinc-500">{{ replyAnonymous ? t('topic.replyingAnonymously') : t('topic.replyingAs', { name: actor.displayName || `${actor.username}@${nodeDomain}` }) }}</p>
                </div>
              </div>
              <span class="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200">Markdown</span>
            </div>
            <label class="sr-only" for="topic-reply-body">{{ t('topic.replyLabel') }}</label>
            <textarea id="topic-reply-body" ref="replyBodyInput" data-testid="topic-reply-body" v-model="replyBody" required minlength="3" maxlength="10000" rows="8" class="min-h-48 w-full resize-y border-0 bg-white px-5 py-4 text-base leading-8 text-zinc-900 outline-none placeholder:text-zinc-400 focus:ring-0 sm:px-6" :placeholder="t('topic.replyPlaceholder')" />
            <p v-if="replyError && !replyingTo" role="alert" class="mx-5 mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800 sm:mx-6">{{ replyError }}</p>
            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/70 px-5 py-3 sm:px-6">
              <div class="flex flex-wrap items-center gap-4">
                <span class="text-xs text-zinc-500">{{ t('topic.replyLabel') }}</span>
                <label class="inline-flex items-center gap-2 text-xs text-zinc-600">
                  <span>{{ t('topic.contentLanguage') }}</span>
                  <select v-model="replyLocale" data-testid="topic-reply-locale" class="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800">
                    <option v-for="language in contentLanguages" :key="language.code" :value="language.code">{{ language.name }}</option>
                  </select>
                </label>
                <label class="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-600" data-testid="topic-reply-anonymous">
                  <input v-model="replyAnonymous" type="checkbox" class="size-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600">
                  <span>{{ t('topic.replyAnonymous') }}</span>
                </label>
              </div>
              <UButton type="submit" color="primary" :loading="replyPending" :disabled="replyPending">{{ t('topic.postReply') }}</UButton>
            </div>
          </form>
          <div v-else class="mt-6 rounded-2xl bg-emerald-50 p-5 text-sm text-emerald-950"><NuxtLink to="/login" class="font-semibold underline">{{ t('topics.signUpToStart') }}</NuxtLink>{{ t('topic.join') }}</div>
        </section>

        <AppModal
          :open="Boolean(replyDeleteTarget)"
          :title="t('topic.deleteReply')"
          :description="t('topic.deleteReplyDescription')"
          :close-label="t('topic.deleteReplyCancel')"
          @close="closeReplyDelete"
        >
          <div data-testid="comment-delete-panel" class="space-y-4">
            <p class="text-sm leading-6 text-zinc-700">{{ t('topic.deleteReplyConfirm') }}</p>
            <p v-if="replyDeleteError" role="alert" class="rounded-xl bg-red-50 p-3 text-sm text-red-800">{{ replyDeleteError }}</p>
            <div class="flex flex-wrap justify-end gap-3">
              <button type="button" class="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-100" :disabled="replyDeletePending" @click="closeReplyDelete">{{ t('topic.deleteReplyCancel') }}</button>
              <UButton type="button" color="error" :loading="replyDeletePending" :disabled="replyDeletePending" data-testid="comment-delete-confirm" @click="confirmReplyDelete">{{ t('topic.deleteReply') }}</UButton>
            </div>
          </div>
        </AppModal>

        <footer data-testid="page-responsibility" class="mt-8 rounded-[1.75rem] border border-zinc-200/80 bg-white px-6 py-5 text-sm leading-6 text-zinc-500 shadow-sm sm:px-8">
          <p>{{ t('topic.pageResponsibility') }}</p>
          <div class="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <time v-if="updatedUtcLabel" :datetime="updatedAtIso">{{ t('topic.lastUpdatedUtc', { time: updatedUtcLabel }) }}</time>
            <button type="button" class="text-xs text-zinc-500 underline hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" :aria-expanded="reportOpen" aria-controls="page-report-form" @click="reportOpen = !reportOpen">{{ t('topic.reportPage') }}</button>
          </div>
          <p v-if="reportSent" role="status" class="mt-3 text-sm text-emerald-800">{{ t('topic.reportSent') }}</p>
          <form v-if="reportOpen" id="page-report-form" class="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4" @submit.prevent="submitReport">
            <label class="block text-sm text-zinc-700">{{ t('topic.reportReason') }}
              <select v-model="reportReason" class="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100">
                <option value="inaccurate">{{ t('topic.reportReasonInaccurate') }}</option>
                <option value="illegal">{{ t('topic.reportReasonIllegal') }}</option>
                <option value="rights">{{ t('topic.reportReasonRights') }}</option>
                <option value="other">{{ t('topic.reportReasonOther') }}</option>
              </select>
            </label>
            <label class="mt-3 block text-sm text-zinc-700">{{ t('topic.reportDetails') }}
              <textarea v-model="reportDetails" required minlength="8" maxlength="2000" rows="4" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-zinc-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" :placeholder="t('topic.reportDetailsHint')" />
            </label>
            <p class="mt-2 text-xs leading-5 text-zinc-500">{{ t('topic.reportPrivate') }}</p>
            <p v-if="reportError" role="alert" class="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{{ reportError }}</p>
            <div class="mt-4 flex flex-wrap items-center justify-end gap-3">
              <button type="button" class="text-sm text-zinc-600 underline" @click="reportOpen = false">{{ t('topic.reportClose') }}</button>
              <UButton type="submit" color="primary" :loading="reportPending" :disabled="reportPending">{{ t('topic.reportSubmit') }}</UButton>
            </div>
          </form>
        </footer>

        <section data-testid="page-visitors" class="mt-4 px-1 text-xs leading-5 text-zinc-600" :aria-label="t('topic.visitorActivity')">
          <ul class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <li><span class="tabular-nums text-zinc-700">{{ visitors.botScans }}</span> {{ t('topic.botScans') }}</li>
            <li v-for="bot in visitors.bots" :key="bot.label" class="inline-flex items-center gap-2.5">
              <span aria-hidden="true" class="text-zinc-300">·</span>
              <span>{{ bot.label }} <span class="tabular-nums text-zinc-700">{{ formatCount(bot.hits) }}</span></span>
            </li>
            <li class="inline-flex items-center gap-2.5">
              <span aria-hidden="true" class="text-zinc-300">·</span>
              <span><span class="tabular-nums text-zinc-700">{{ formatCount(topic.unique_web_readers) }}</span> {{ t('topic.humanViews') }}</span>
            </li>
            <li v-if="lastBotScanLabel" class="inline-flex items-center gap-2.5 text-zinc-500 sm:ml-auto">
              <span aria-hidden="true" class="text-zinc-300 sm:hidden">·</span>
              <span>{{ t('topic.lastBotScan', { time: lastBotScanLabel }) }}</span>
            </li>
          </ul>
          <details v-if="machineEndpoints.length" id="machine-endpoints" class="mt-3 scroll-mt-24 rounded-2xl border border-zinc-200/80 bg-white/80 p-3 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/85" aria-labelledby="machine-endpoints-heading">
            <summary class="cursor-pointer list-none text-sm font-semibold text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:text-zinc-100">
              <span class="flex items-center justify-between gap-3"><span id="machine-endpoints-heading">{{ t('topic.machineEndpoints') }}</span><span aria-hidden="true" class="text-zinc-400 dark:text-zinc-500">⌄</span></span>
            </summary>
            <ul class="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50/50 text-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950/30">
              <li v-for="endpoint in machineEndpoints" :key="endpoint.label" class="flex items-start justify-between gap-3 px-2 py-2">
                <div class="min-w-0">
                  <span class="mr-2 inline-block w-20 shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">{{ endpoint.label }}</span>
                  <a :href="endpoint.path" class="break-all font-mono text-xs text-emerald-900 hover:underline dark:text-emerald-300">{{ endpoint.pathname }}<wbr>{{ endpoint.query }}</a>
                </div>
                <button type="button" class="shrink-0 rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" @click="copyValue(endpoint.absolute, endpoint.label)">
                  {{ copiedKey === endpoint.label ? t('topic.linkCopied') : t('topic.copy') }}
                </button>
              </li>
            </ul>
          </details>
        </section>
      </div>

      <AppModal
        :open="proposalModalOpen"
        :title="t('topic.proposeSelection')"
        :description="t('topic.proposeSelectionDescription')"
        :close-label="t('topic.reportClose')"
        @close="closeProposalModal"
      >
        <EditProposalPanel
          v-if="proposalModalOpen"
          :topic="topic"
          :actor="actor"
          form-only
          :initial-title="topic.title"
          :initial-body="proposalBodySeed"
          :initial-selection="proposalSelectionSeed"
          :initial-rationale="proposalRationaleSeed"
          @submitted="closeProposalModal"
        />
      </AppModal>

      <AppModal
        :open="editPageOpen"
        :title="t('topic.editPage')"
        :description="t('topic.editPageDescription')"
        :close-label="t('topic.reportClose')"
        @close="closeEditPage"
      >
        <form data-testid="page-edit-form" class="space-y-4" @submit.prevent="savePageEdit">
          <label class="block text-sm font-medium text-zinc-700">{{ t('topic.title') }}
            <input v-model="editTitle" required minlength="8" maxlength="180" data-testid="page-edit-title" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100">
          </label>
          <label class="block text-sm font-medium text-zinc-700">{{ t('composer.details') }}
            <textarea v-model="editBody" required minlength="20" maxlength="40000" rows="14" data-testid="page-edit-body" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 font-mono text-sm leading-6 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" />
          </label>
          <label class="block text-sm font-medium text-zinc-700">{{ t('topic.overview') }}
            <textarea v-model="editSummary" maxlength="2000" rows="3" data-testid="page-edit-summary" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" :placeholder="t('composer.overviewHint')" />
          </label>
          <p v-if="editError" role="alert" data-testid="page-edit-error" class="rounded-xl bg-red-50 p-3 text-sm text-red-800">{{ editError }}</p>
          <p v-if="editNotice" role="status" data-testid="page-edit-notice" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{{ editNotice }}</p>
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-100" @click="closeEditPage">{{ t('topic.reportClose') }}</button>
            <UButton type="submit" color="primary" :loading="editPending" :disabled="editPending">{{ t('topic.savePageRevision') }}</UButton>
          </div>
        </form>
      </AppModal>

      <aside ref="topicAside" class="topic-aside min-w-0 space-y-5">
        <nav v-if="pageNavigation.length" class="max-md:hidden rounded-[1.5rem] border border-zinc-200/80 bg-white p-5 shadow-sm" :aria-label="t('topic.pageNavigation')">
          <h2 class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{{ t('topic.contents') }}</h2>
          <ol class="mt-4 space-y-1.5 text-sm">
            <li v-for="item in pageNavigation" :key="item.id" :style="item.level ? { paddingLeft: `${(item.level - 2) * 0.7}rem` } : undefined">
                <a :href="`#${item.id}`" class="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 leading-5 text-zinc-600 transition hover:bg-emerald-50 hover:text-emerald-950" @click.prevent="scrollToPageNavigation(item.id, $event)"><span>{{ item.text }}</span><span v-if="item.id === 'article-proposals'" data-testid="open-proposals-badge" class="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold leading-4 text-amber-900">{{ formatCount(topic.open_proposal_count) }}</span></a>
            </li>
          </ol>
        </nav>

        <section class="rounded-[1.5rem] border border-zinc-200/80 bg-white p-5 shadow-sm" aria-labelledby="page-details-heading">
          <div>
            <h2 id="page-details-heading" class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{{ t('topic.pageDetails') }}</h2>
            <p class="mt-1 break-words font-mono text-[10px] leading-4 text-zinc-400">/{{ topic.page_number || slug }}</p>
          </div>
          <dl class="mt-5 space-y-4 text-sm">
            <div v-if="topic.page_number"><dt class="text-xs text-zinc-400">{{ t('topic.numberLabel') }}</dt><dd class="mt-1 font-mono text-zinc-800">{{ t('topic.pageNumber', { number: topic.page_number }) }}</dd></div>
            <div v-if="!topic.hideAuthor"><dt class="text-xs text-zinc-400">{{ t('topic.authorLabel') }}</dt><dd class="mt-1 break-words font-medium text-zinc-800">{{ displayedAuthor }}</dd></div>
            <div><dt class="text-xs text-zinc-400">{{ t('topic.revisionHistory') }}</dt><dd class="mt-1 text-zinc-700">{{ formatCount(topic.revision_count) }}</dd></div>
            <div v-if="topic.citations?.length"><dt class="text-xs text-zinc-400">{{ t('topic.sources') }}</dt><dd class="mt-1 text-zinc-700">{{ formatCount(topic.citations.length) }}</dd></div>
            <div><dt class="text-xs text-zinc-400">{{ t('topic.readers') }}</dt><dd class="mt-1 text-zinc-700">{{ t('topic.uniqueReadersCount', { count: formatCount(topic.unique_web_readers) }) }}</dd></div>
            <div v-if="topic.authorship_mode && !topic.hideAuthor"><dt class="text-xs text-zinc-400">{{ t('topic.authorship') }}</dt><dd class="mt-1 leading-5 text-zinc-700">{{ authorshipDisplayLabel }}</dd></div>
            <div v-if="topic.model_name && !topic.hideAuthor"><dt class="text-xs text-zinc-400">{{ t('topic.modelUsed') }}</dt><dd class="mt-1 break-words text-zinc-700">{{ topic.model_name }}</dd></div>
          </dl>
          <div class="mt-5 space-y-1 border-t border-zinc-100 pt-4">
            <button type="button" data-testid="page-canonical-url" class="block w-full min-w-0 max-w-full cursor-pointer truncate text-left font-mono text-[11px] leading-5 text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" :title="canonicalUrl" :aria-label="t('topic.copyLink')" @click="copyCanonical">{{ canonicalUrl }}</button>
            <p v-if="linkCopied" role="status" data-testid="page-link-copied" class="text-[11px] font-medium text-emerald-800">{{ t('topic.linkCopied') }}</p>
            <p v-if="linkCopyError" role="alert" class="text-[11px] text-amber-800">{{ t('topic.copyLinkFailed') }}</p>
            <p v-if="addressCode" data-testid="page-short-url" class="font-mono text-[11px] leading-5 text-emerald-800" :aria-label="t('topic.addressCode')">{{ addressCode }}</p>
          </div>
          <p data-testid="page-last-edit" class="mt-4 border-t border-zinc-100 pt-4 text-sm">
            <span class="text-xs text-zinc-400">{{ t('topic.lastEdited') }}</span>
            <time class="mt-1 block text-zinc-700" :datetime="updatedAtIso">{{ formatDateTime(topic.revision_created_at) }}</time>
          </p>
        </section>
      </aside>
  </article>
  <PublicProfile v-else-if="profileData?.profile" :data="profileData" />
  <section v-else-if="error" class="mx-auto max-w-2xl rounded-2xl border border-zinc-200 bg-white p-8">
    <BackLink to="/topics">{{ t('topic.all') }}</BackLink>
    <h1 class="mt-5 font-serif text-2xl font-semibold">{{ t('topic.unavailable') }}</h1>
    <p class="mt-2 text-zinc-500">{{ t('topic.notFound') }}</p>
  </section>
  <div v-else class="mx-auto max-w-2xl p-8 text-zinc-500">{{ t('topic.loading') }}</div>
</template>

<script setup>
import { setResponseStatus } from 'h3'
import { buildCommentThreads, COMMENT_SORTS } from '~/utils/comment-threads.js'
import { languages } from '~/utils/i18n.js'
import { formatCount } from '~/utils/number-format.js'

definePageMeta({ fullBleed: true, pageTransition: { name: 'aiki-page', mode: 'out-in' }, alias: ['/:slug/:lang(en|zh|ru|es|ja|de|fr|ar)'] })

const route = useRoute()
const { t, locale } = useLocale()
const contentLanguages = languages
const { public: { nodeDomain, siteUrl } } = useRuntimeConfig()
const nodePublic = useNuxtData('node-public').data
const slug = computed(() => String(route.params.slug || ''))
const PAGE_LOCALES = ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar']
const OG_LOCALES = { en: 'en_US', zh: 'zh_CN', ru: 'ru_RU', es: 'es_ES', ja: 'ja_JP', de: 'de_DE', fr: 'fr_FR', ar: 'ar_AR' }
// /31/ru pins the page language. Without it, a visitor who chose a language
// reads the page in that language; link previews and first visits (no saved
// choice) get the language the page was written in.
const routeLang = computed(() => PAGE_LOCALES.includes(String(route.params.lang || '')) ? String(route.params.lang) : null)
const localePreference = useCookie('aiki-locale')
const explicitLocalePreference = useCookie('aiki-locale-explicit')
// The site stores the browser language on first visit; that automatic choice
// must not swap the page under the reader. Only a saved or explicit choice does.
const followUiLocale = ref(Boolean(explicitLocalePreference.value === '1'))
watch(explicitLocalePreference, (next) => {
  if (next === '1') followUiLocale.value = true
})
const contentLocale = computed(() => routeLang.value || (followUiLocale.value ? locale.value : 'original'))
const authorshipLabel = computed(() => t(({ human_only: 'topic.authorshipHumanOnly', human_ai_collaboration: 'topic.authorshipCollaboration', ai_generated_human_reviewed: 'topic.authorshipAIReviewed', ai_generated_unreviewed: 'topic.authorshipAIUnreviewed', external_import: 'topic.authorshipExternalImport', legacy_undisclosed: 'topic.authorshipLegacy' })[topic.value?.authorship_mode] || 'topic.authorshipLegacy'))
const authorshipDisplayLabel = computed(() => authorshipLabel.value)

const { data: authState } = await useFetch('/api/auth/me')
const actor = computed(() => authState.value?.actor || null)
const activityTick = ref(0)
const sourcesExpanded = ref(false)
const overviewExpanded = ref(false)
const accessPending = ref(false)
const accessError = ref('')
const authorPending = ref(false)
const authorError = ref('')
const discussionPending = ref(false)
const discussionError = ref('')
const settingsOpen = ref(false)
const transferAvailable = ref(false)
const editPageOpen = ref(false)
const editTitle = ref('')
const editBody = ref('')
const editSummary = ref('')
const editPending = ref(false)
const editError = ref('')
const editNotice = ref('')
const showAccess = computed(() => topic.value && (topic.value.access !== 'public' || topic.value.canChangeAccess))
const showPageSettings = computed(() => Boolean(topic.value && (topic.value.canEdit || topic.value.canChangeAccess || topic.value.canHideAuthor || topic.value.canToggleAssistantCheck || transferAvailable.value)))
const revisionHistoryOpen = ref(false)
const revisionHistoryTrigger = ref(null)
function closeRevisionHistory() {
  revisionHistoryOpen.value = false
  nextTick(() => revisionHistoryTrigger.value?.focus())
}

// A Fediverse author links to the original post on their server (else their profile).
const fediverseAuthorLink = computed(() => topic.value?.federation?.actor ? (topic.value.federation.sourceUrl || topic.value.federation.actor.profileUrl || null) : null)
const authorAvatarUrl = computed(() => topic.value?.import?.author?.avatarUrl || topic.value?.federation?.actor?.avatarUrl || topic.value?.author_avatar_url || null)
const displayedAuthor = computed(() => {
  if (topic.value?.hideAuthor) return ''
  if (topic.value?.import) return topic.value.import.author?.name || t('topic.importUnknownAuthor')
  // Fediverse authors are shown as @user@server; display name is the fallback.
  return (topic.value?.federation?.actor?.acct ? `@${topic.value.federation.actor.acct}` : '')
    || topic.value?.federation?.actor?.displayName
    || topic.value?.author_display_name
    || `${topic.value?.author || 'community'}@${nodeDomain}`
})
const overviewUpdatedBy = computed(() => {
  const updater = topic.value?.summaryUpdatedBy
  if (!updater?.username) return ''
  return updater.displayName || `${updater.username}@${nodeDomain}`
})
const linkCopied = ref(false)
const linkCopyError = ref(false)
let linkCopyTimer
const replyBody = ref('')
const replyLocale = ref(locale.value)
const replyAnonymous = ref(false)
const replyPending = ref(false)
const replyError = ref('')
const replyingTo = ref('')
const editingReplyId = ref('')
const replyEditPendingId = ref('')
const replyEditError = ref('')
const replyDeleteTarget = ref(null)
const replyDeletePending = ref(false)
const replyDeleteError = ref('')
const votePendingId = ref('')
const topicVotePending = ref(false)
const topicVoteError = ref('')
const replyMorePending = ref(false)
const replyMoreError = ref('')
const reportOpen = ref(false)
const reportReason = ref('inaccurate')
const reportDetails = ref('')
const reportPending = ref(false)
const reportError = ref('')
const reportSent = ref(false)
const copiedKey = ref('')
const articleContent = ref(null)
const replyBodyInput = ref(null)
const selectionText = ref('')
const selectionToolbarStyle = ref({})
const proposalModalOpen = ref(false)
const proposalBodySeed = ref('')
const proposalSelectionSeed = ref('')
const proposalRationaleSeed = ref('')
const aiRequestOpen = ref(false)
const aiRequestType = ref('research')
const aiRequestInstruction = ref('')
const aiRequestPending = ref(false)
const aiRequestError = ref('')
const aiRequest = ref(null)
const proposalRefreshKey = ref(0)
let aiRequestPollTimer
let pageClassificationPollTimer
let pageClassificationPollPending = false
const classificationRetryPending = ref(false)
const classificationRetryError = ref('')

// A failed classification (provider outage, bad config) can be run again
// instead of leaving the page untyped and without its follow-up tasks.
async function retryClassification() {
  if (classificationRetryPending.value || !topic.value) return
  classificationRetryPending.value = true
  classificationRetryError.value = ''
  try {
    await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/ai-requests`, {
      method: 'POST',
      body: { requestType: 'classify_page', locale: topic.value.locale },
    })
    await refresh()
  } catch (error) {
    classificationRetryError.value = error?.data?.statusMessage || t('topic.classificationFailed')
  } finally {
    classificationRetryPending.value = false
  }
}
const aiRequestOptions = computed(() => {
  const common = [
    { value: 'overview', label: 'topic.aiRequestOverview', description: 'topic.aiRequestOverviewDescription' },
    { value: 'discussion_reply', label: 'topic.aiRequestDiscussion', description: 'topic.aiRequestDiscussionDescription' },
    { value: 'question_answer', label: 'topic.aiRequestQuestion', description: 'topic.aiRequestQuestionDescription' },
  ]
  return [
    { value: 'research', label: 'topic.aiRequestResearch', description: 'topic.aiRequestResearchDescription' },
    ...common,
  ]
})

function clearArticleSelection() {
  selectionText.value = ''
  selectionToolbarStyle.value = {}
}

function openEditPage() {
  if (!topic.value?.canEdit) return
  editTitle.value = String(topic.value.title || '')
  editBody.value = String(topic.value.body_markdown || '')
  editSummary.value = String(topic.value.summary || '')
  editError.value = ''
  editNotice.value = ''
  settingsOpen.value = false
  editPageOpen.value = true
}

function closeEditPage() {
  if (editPending.value) return
  editPageOpen.value = false
}

async function savePageEdit() {
  if (!topic.value?.canEdit || editPending.value) return
  editPending.value = true
  editError.value = ''
  editNotice.value = ''
  try {
    await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/revisions`, {
      method: 'POST',
      body: {
        locale: topic.value.locale,
        title: editTitle.value,
        body: editBody.value,
        summary: editSummary.value,
      },
    })
    await refresh()
    editNotice.value = t('topic.pageEditSaved')
    editPageOpen.value = false
  } catch (error) {
    editError.value = error?.data?.statusMessage || t('topic.pageEditFailed')
  } finally {
    editPending.value = false
  }
}

function captureArticleSelection() {
  if (typeof window === 'undefined') return
  if (topic.value?.kind !== 'article') {
    clearArticleSelection()
    return
  }
  nextTick(() => {
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const text = selection?.toString().trim() || ''
    if (!range || !text || text.length < 2 || !articleContent.value?.contains(range.commonAncestorContainer)) {
      clearArticleSelection()
      return
    }
    const rect = range.getBoundingClientRect()
    const width = 290
    selectionText.value = text.slice(0, 4000)
    selectionToolbarStyle.value = {
      top: `${Math.max(8, Math.min(window.innerHeight - 56, rect.bottom + 8))}px`,
      left: `${Math.max(8, Math.min(window.innerWidth - width, rect.left + (rect.width / 2) - (width / 2)))}px`,
    }
  })
}

function quotedSelection(text) {
  return String(text || '').split(/\r?\n/).map(line => `> ${line.trim()}`).join('\n')
}

async function askAboutSelection() {
  if (!actor.value) {
    await navigateTo('/login')
    return
  }
  const quote = quotedSelection(selectionText.value)
  replyBody.value = `${replyBody.value.trim() ? `${replyBody.value.trim()}\n\n` : ''}${quote}\n\n`
  clearArticleSelection()
  await nextTick()
  replyBodyInput.value?.focus()
  replyBodyInput.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function proposeSelection() {
  if (!actor.value) {
    void navigateTo('/login')
    return
  }
  proposalSelectionSeed.value = selectionText.value
  proposalBodySeed.value = String(topic.value?.body_markdown || '')
  proposalRationaleSeed.value = ''
  proposalModalOpen.value = true
  clearArticleSelection()
}

function closeProposalModal() {
  proposalModalOpen.value = false
  proposalBodySeed.value = ''
  proposalSelectionSeed.value = ''
  proposalRationaleSeed.value = ''
}

function openAiRequest() {
  if (!actor.value) {
    void navigateTo('/login')
    return
  }
  aiRequestOpen.value = true
  aiRequestError.value = ''
  aiRequest.value = null
  aiRequestType.value = aiRequestOptions.value[0]?.value || 'research'
}

function closeAiRequest() {
  if (aiRequestPending.value) return
  clearTimeout(aiRequestPollTimer)
  aiRequestOpen.value = false
  aiRequest.value = null
  aiRequestError.value = ''
}

function resetAiRequest() {
  clearTimeout(aiRequestPollTimer)
  aiRequest.value = null
  aiRequestError.value = ''
}

async function submitAiRequest() {
  if (!actor.value || aiRequestPending.value || !topic.value) return
  aiRequestPending.value = true
  aiRequestError.value = ''
  try {
    const response = await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/ai-requests`, {
      method: 'POST',
      body: {
        requestType: aiRequestType.value,
        locale: topic.value.locale || locale.value,
        instruction: aiRequestInstruction.value,
      },
    })
    aiRequest.value = response.request
    scheduleAiRequestPoll()
  } catch (error) {
    aiRequestError.value = (error?.statusCode || error?.status) === 402 ? t('topic.aiRequestNoBalance') : error?.data?.statusMessage || t('topic.aiRequestFailed')
  } finally {
    aiRequestPending.value = false
  }
}

function scheduleAiRequestPoll() {
  clearTimeout(aiRequestPollTimer)
  if (!aiRequest.value || !['queued', 'submitted'].includes(aiRequest.value.status)) return
  aiRequestPollTimer = setTimeout(() => { void pollAiRequest() }, 4000)
}

async function pollAiRequest() {
  if (!aiRequest.value?.id) return
  try {
    const wasCompletedMutation = Boolean(aiRequest.value.result?.publishedReply?.id || aiRequest.value.result?.publishedProposal?.id || aiRequest.value.result?.updatedOverview?.revisionId)
    const response = await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/ai-requests/${encodeURIComponent(aiRequest.value.id)}`)
    aiRequest.value = response.request
    if (!wasCompletedMutation && (response.request.result?.publishedReply?.id || response.request.result?.publishedProposal?.id || response.request.result?.updatedOverview?.revisionId)) {
      if (response.request.result?.publishedProposal?.id) proposalRefreshKey.value += 1
      await refresh()
    }
  } catch (error) {
    aiRequestError.value = error?.data?.statusMessage || t('topic.aiRequestFailed')
  }
  scheduleAiRequestPoll()
}

function useAiSupplement() {
  const result = aiRequest.value?.result
  if (!result?.proposedBody) return
  if (aiRequest.value?.baseRevisionId && aiRequest.value.baseRevisionId !== topic.value?.revision_id) {
    aiRequestError.value = t('topic.aiRequestStale')
    return
  }
  proposalBodySeed.value = result.proposedBody
  proposalSelectionSeed.value = ''
  proposalRationaleSeed.value = result.rationale || ''
  aiRequestOpen.value = false
  proposalModalOpen.value = true
}

async function useAiAnswer() {
  const answer = String(aiRequest.value?.result?.answer || '').trim()
  if (!answer) return
  replyBody.value = `${replyBody.value.trim() ? `${replyBody.value.trim()}\n\n` : ''}${answer}`
  aiRequestOpen.value = false
  await nextTick()
  replyBodyInput.value?.focus()
  replyBodyInput.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function setAuthorVisibility(event) {
  const visibility = event.target.value
  const hideAuthor = visibility === 'profile' ? null : visibility === 'hide'
  authorPending.value = true
  authorError.value = ''
  try {
    await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/author`, { method: 'PATCH', body: { hideAuthor } })
    await refresh()
    activityTick.value += 1
  } catch {
    authorError.value = t('topic.hideAuthorFailed')
    event.target.value = topic.value?.authorVisibility || 'profile'
  } finally {
    authorPending.value = false
  }
}

async function setAccess(event) {
  const access = event.target.value
  accessPending.value = true
  accessError.value = ''
  try {
    await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/visibility`, { method: 'PATCH', body: { access } })
    await refresh()
  } catch {
    accessError.value = t('topic.accessFailed')
    event.target.value = topic.value?.access || access
  } finally {
    accessPending.value = false
  }
}

async function setDiscussionSettings(event) {
    const key = event.target.dataset.setting
    const body = {
      acceptReplies: topic.value?.acceptReplies !== false,
      discussionEnabled: topic.value?.discussionEnabled !== false,
      federationOutboundMode: topic.value?.federationOutboundMode || 'auto',
    }
    body[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    discussionPending.value = true
    discussionError.value = ''
    try {
      await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/discussion`, { method: 'PATCH', body })
      await refresh()
    } catch {
      discussionError.value = t('topic.messageSettingsFailed')
      await refresh()
    } finally {
      discussionPending.value = false
    }
}

async function onManaged() {
  activityTick.value += 1
  await refresh()
}

function toggleReply(reply) {
  if (!actor.value) {
    navigateTo('/login')
    return
  }
  replyingTo.value = replyingTo.value === reply.id ? '' : reply.id
  replyError.value = ''
}

function toggleOverview() {
  overviewExpanded.value = !overviewExpanded.value
}

function openReplyEdit(reply) {
  if (!actor.value) {
    navigateTo('/login')
    return
  }
  editingReplyId.value = reply.id
  replyEditError.value = ''
}

function cancelReplyEdit() {
  if (replyEditPendingId.value) return
  editingReplyId.value = ''
  replyEditError.value = ''
}

function requestReplyDelete(reply) {
  if (!actor.value || !reply?.canEdit) return
  replyDeleteTarget.value = reply
  replyDeleteError.value = ''
}

function closeReplyDelete() {
  if (replyDeletePending.value) return
  replyDeleteTarget.value = null
  replyDeleteError.value = ''
}

async function confirmReplyDelete() {
  if (!actor.value || !replyDeleteTarget.value || replyDeletePending.value) return
  replyDeletePending.value = true
  replyDeleteError.value = ''
  try {
    const deletedId = replyDeleteTarget.value.id
    await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/replies/${encodeURIComponent(deletedId)}`, { method: 'DELETE' })
    if (editingReplyId.value === deletedId) cancelReplyEdit()
    replyDeleteTarget.value = null
    await refresh()
  } catch (error) {
    replyDeleteError.value = error?.data?.statusMessage || t('topic.replyDeleteFailed')
    if (error?.statusCode === 401) await navigateTo('/login')
  } finally {
    replyDeletePending.value = false
  }
}

async function submitReplyEdit(edit) {
  if (!actor.value || replyEditPendingId.value) return
  replyEditPendingId.value = edit.replyId
  replyEditError.value = ''
  try {
    await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/replies/${encodeURIComponent(edit.replyId)}`, {
      method: 'PATCH',
      body: { body: edit.body, anonymous: edit.anonymous === true },
    })
    editingReplyId.value = ''
    await refresh()
  } catch (error) {
    replyEditError.value = error?.data?.statusMessage || t('topic.replyEditFailed')
    if (error?.statusCode === 401) await navigateTo('/login')
  } finally {
    replyEditPendingId.value = ''
  }
}

async function voteOnReply(reply, direction) {
  if (!actor.value) {
    await navigateTo('/login')
    return
  }
  if (votePendingId.value) return
  votePendingId.value = reply.id
  const next = reply.my_vote === direction ? 0 : direction
  try {
    const result = await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/replies/${encodeURIComponent(reply.id)}/votes`, {
      method: 'POST',
      body: { value: next },
    })
    applyVote(reply.id, result.vote)
  } catch (error) {
    replyError.value = voteFailure()
    if (error?.statusCode === 401) await navigateTo('/login')
  } finally {
    votePendingId.value = ''
  }
}

async function voteOnTopic(direction) {
  if (!actor.value) {
    await navigateTo('/login')
    return
  }
  if (topicVotePending.value || !topic.value) return
  topicVotePending.value = true
  topicVoteError.value = ''
  const next = topic.value.my_vote === direction ? 0 : direction
  try {
    const result = await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/votes`, {
      method: 'POST',
      body: { value: next },
    })
    const vote = { ...(result.vote || {}) }
    delete vote.topic_id
    data.value = { ...data.value, ...vote }
  } catch (error) {
    topicVoteError.value = error?.data?.statusMessage || t('topic.voteFailed')
    if (error?.statusCode === 401) await navigateTo('/login')
  } finally {
    topicVotePending.value = false
  }
}

async function loadMoreReplies() {
  if (replyMorePending.value || !data.value?.replies_has_more) return
  replyMorePending.value = true
  replyMoreError.value = ''
  try {
    const offset = Number(data.value.replies_offset || 0) + Number(data.value.replies?.length || 0)
    const next = await $fetch(`/api/topics/${encodeURIComponent(slug.value)}`, {
      query: { locale: contentLocale.value, repliesLimit: 100, repliesOffset: offset, skipRead: 'true' },
    })
    data.value = {
      ...data.value,
      replies: [...(data.value.replies || []), ...(next.replies || [])],
      replies_offset: next.replies_offset,
      replies_limit: next.replies_limit,
      replies_has_more: next.replies_has_more,
    }
  } catch (error) {
    replyMoreError.value = error?.data?.statusMessage || t('topic.replyLoadFailed')
  } finally {
    replyMorePending.value = false
  }
}

function applyVote(replyId, vote) {
  const current = data.value
  if (!current?.replies || !vote) return
  data.value = {
    ...current,
    replies: current.replies.map(reply => reply.id === replyId
      ? { ...reply, upvotes: vote.upvotes, downvotes: vote.downvotes, score: vote.score, my_vote: vote.my_vote }
      : reply),
  }
}

async function submitReply(extra = {}) {
  const parentReplyId = extra.parentReplyId || ''
  const text = extra.body ?? replyBody.value
  replyPending.value = true
  replyError.value = ''
  try {
    await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/replies`, {
      method: 'POST',
      body: {
        body: text,
        locale: extra.locale || replyLocale.value || locale.value,
        ...(parentReplyId ? { parentReplyId } : {}),
        anonymous: parentReplyId ? extra.anonymous === true : replyAnonymous.value === true,
      },
    })
    if (parentReplyId) replyingTo.value = ''
    else {
      replyBody.value = ''
      replyAnonymous.value = false
    }
    await refresh()
  } catch (error) {
    replyError.value = replyFailure(error)
    if (error?.statusCode === 401) await navigateTo('/login')
  } finally {
    replyPending.value = false
  }
}

function replyFailure(error) {
  const message = error?.data?.statusMessage || ''
  if (message === 'This thread is already as deep as replies can go.') return t('topic.threadDepth')
  if (message === 'Reply to a published comment on this page.') return t('topic.replyParentMissing')
  return t('topic.replyFailed')
}

function voteFailure() {
  return t('topic.voteFailed')
}

async function submitReport() {
  reportPending.value = true
  reportError.value = ''
  try {
    await $fetch(`/api/topics/${encodeURIComponent(slug.value)}/reports`, {
      method: 'POST',
      body: {
        reason: reportReason.value,
        details: reportDetails.value,
        locale: topic.value?.locale || locale.value,
      },
    })
    reportSent.value = true
    reportOpen.value = false
    reportDetails.value = ''
  } catch (error) {
    reportError.value = error?.data?.statusMessage || t('topic.reportFailed')
  } finally {
    reportPending.value = false
  }
}

const requestHeaders = import.meta.server ? useRequestHeaders(['user-agent']) : undefined
const topicFetchKey = computed(() => `topic-page:${slug.value}:${contentLocale.value}`)
const { data, error, pending, refresh } = await useFetch(() => `/api/topics/${encodeURIComponent(slug.value)}`, {
  key: topicFetchKey,
  query: computed(() => ({ locale: contentLocale.value, repliesLimit: 100, repliesOffset: 0 })),
  watch: [slug, contentLocale],
  headers: requestHeaders?.['user-agent'] ? { 'user-agent': requestHeaders['user-agent'] } : undefined,
})
const orderedSources = computed(() => (topic.value?.citations || [])
  .map((source, index) => ({ source, index }))
  .sort((a, b) => sourceTimestamp(b.source) - sourceTimestamp(a.source) || a.index - b.index))
const hiddenSourceCount = computed(() => Math.max(0, orderedSources.value.length - 4))
const displayedSources = computed(() => sourcesExpanded.value ? orderedSources.value : orderedSources.value.slice(0, 4))

function sourceTimestamp(source) {
  const value = source?.published_at || source?.retrieved_at
  const timestamp = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(timestamp) ? 0 : timestamp
}
// No page at this address: /<username> shows that person's or agent's profile.
const topicMissing = computed(() => error.value?.statusCode === 404 || error.value?.status === 404)
const { data: profileData, execute: loadProfile } = await useFetch(() => `/api/profiles/${encodeURIComponent(slug.value)}`, {
  query: { locale },
  key: `profile-address-${slug.value}`,
  immediate: false,
})
if (topicMissing.value) await loadProfile().catch(() => {})
watch(topicMissing, missing => { if (missing && !profileData.value) loadProfile().catch(() => {}) })
if (import.meta.server && topicMissing.value && !profileData.value?.profile) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 404)
}
const topic = computed(() => data.value || null)
// Long titles get a smaller size so a whole sentence does not fill the screen.
const titleSizeClass = computed(() => {
  const length = String(topic.value?.title || '').length
  if (length > 120) return 'text-2xl leading-tight sm:text-3xl'
  if (length > 70) return 'text-3xl leading-[1.12] sm:text-4xl'
  return 'text-4xl leading-[1.08] sm:text-5xl lg:text-[clamp(2.75rem,4vw,4.5rem)]'
})
const COMMENT_SORT_KEY = 'aiki-comment-sort'
const commentSort = ref('oldest')
const threads = computed(() => buildCommentThreads(topic.value?.replies || [], { sort: commentSort.value }))
onMounted(() => {
  try {
    const saved = localStorage.getItem(COMMENT_SORT_KEY)
    if (COMMENT_SORTS.includes(saved)) commentSort.value = saved
  } catch {}
})
function setCommentSort(value) {
  commentSort.value = value
  try { localStorage.setItem(COMMENT_SORT_KEY, value) } catch {}
}
const updatedAtIso = computed(() => {
  const value = topic.value?.revision_created_at
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
})
const updatedUtcLabel = computed(() => formatUtcStamp(topic.value?.revision_created_at))
const visitors = computed(() => {
  const value = topic.value?.visitors
  return {
    botScans: Number(value?.botScans || 0),
    humanViews: Number(value?.humanViews || 0),
    bots: Array.isArray(value?.bots) ? value.bots : [],
  }
})
const lastBotScanLabel = computed(() => formatUtcStamp(topic.value?.visitors?.lastBotScanAt))
const machineEndpoints = computed(() => {
  if (!topic.value) return []
  const origin = String(siteUrl).replace(/\/$/, '')
  const pagePath = topic.value.page_number ? `/${topic.value.page_number}` : `/${encodeURIComponent(slug.value)}`
  const query = `?locale=${encodeURIComponent(topic.value.locale || 'en')}`
  return [
    ['HTML', pagePath],
    ['Markdown', `${pagePath}.md${query}`],
    ['Text', `${pagePath}.txt${query}`],
    ['JSON', `${pagePath}.json${query}`],
    ['JSON-LD', `${pagePath}.jsonld${query}`],
  ].map(([label, path]) => ({
    label,
    path,
    pathname: path.split('?')[0],
    query: path.includes('?') ? path.slice(path.indexOf('?')) : '',
    absolute: `${origin}${path}`,
  }))
})
const pageAddress = computed(() => topic.value?.page_number ? `/${topic.value.page_number}` : `/${encodeURIComponent(slug.value)}`)
const canonicalUrl = computed(() => `${String(siteUrl).replace(/\/$/, '')}${pageAddress.value}`)
const localizedUrl = (code) => `${canonicalUrl.value}/${code}`
const headUrl = computed(() => routeLang.value && topic.value?.locale ? localizedUrl(topic.value.locale) : canonicalUrl.value)
const publisherName = computed(() => nodePublic.value?.node?.displayName || 'AiKi')
const publisherContactUrl = computed(() => nodePublic.value?.node?.contactUrl || '')
const publishedAtIso = computed(() => {
  const value = topic.value?.created_at
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
})
const structuredData = computed(() => {
  const current = topic.value
  if (!current || !publishedAtIso.value || !headUrl.value) return ''
  const origin = String(siteUrl).replace(/\/$/, '')
  const software = current.model_name ? { '@type': 'SoftwareApplication', name: current.model_name } : null
  const person = current.hideAuthor ? null : { '@type': 'Person', name: displayedAuthor.value }
  const author = current.authorship_mode === 'human_ai_collaboration' && person && software
    ? [person, software]
    : current.authorship_mode?.startsWith('ai_generated') && software
      ? software
      : person || software || undefined
  const document = {
    '@context': 'https://schema.org',
    '@type': current.kind === 'article' ? 'NewsArticle' : current.kind === 'question' ? 'Question' : current.kind === 'discussion' ? 'DiscussionForumPosting' : 'CreativeWork',
    '@id': headUrl.value,
    url: headUrl.value,
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${headUrl.value}#webpage` },
    inLanguage: current.locale || 'en',
    datePublished: publishedAtIso.value,
    dateModified: updatedAtIso.value || publishedAtIso.value,
    author,
    publisher: {
      '@type': 'Organization',
      '@id': `${origin}/#organization`,
      name: publisherName.value,
      url: origin,
      ...(publisherContactUrl.value ? { contactPoint: { '@type': 'ContactPoint', url: publisherContactUrl.value } } : {}),
    },
  }
  if (current.kind === 'question') {
    document.name = current.title
    document.text = current.body_markdown
  } else if (current.kind === 'discussion') {
    document.headline = current.title
    document.articleBody = current.body_markdown
  } else {
    document.headline = current.title
    document.description = current.summary || undefined
    document.articleBody = current.body_markdown
    if (current.kind === 'article') document.isAccessibleForFree = true
  }
  return JSON.stringify(document).replace(/</g, '\\u003c')
})
const addressCode = computed(() => {
  const code = String(topic.value?.slug || '')
  if (!code || code === String(topic.value?.page_number || '') || code.length > 32) return ''
  return code
})

// Classification is a background update. Do not use useFetch.refresh() here:
// it toggles the page-level pending state, shows the loading indicator, and
// records another page read on every poll. Fetch the current snapshot silently
// and replace the data once it arrives.
async function pollPageClassification() {
  if (pageClassificationPollPending || !['queued', 'submitted'].includes(topic.value?.pageClassification?.status)) return
  pageClassificationPollPending = true
  try {
    const latest = await $fetch(`/api/topics/${encodeURIComponent(slug.value)}`, {
      query: {
        locale: contentLocale.value,
        repliesLimit: 100,
        repliesOffset: 0,
        skipRead: 'true',
      },
    })
    if (latest) data.value = latest
  } catch {
    // A transient poll failure should not disturb the page the reader is on.
  } finally {
    pageClassificationPollPending = false
  }
}

watch(() => topic.value?.page_number, (number) => {
  if (number == null || String(slug.value) === String(number)) return
  void navigateTo({ path: `/${number}`, hash: route.hash, query: route.query }, { replace: true })
})

async function copyValue(value, key) {
  try {
    await navigator.clipboard.writeText(value)
    copiedKey.value = key
    clearTimeout(linkCopyTimer)
    linkCopyTimer = setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = ''
    }, 1600)
  } catch {
    copiedKey.value = ''
  }
}

async function copyCanonical() {
  linkCopyError.value = false
  try {
    await navigator.clipboard.writeText(canonicalUrl.value)
    linkCopied.value = true
    clearTimeout(linkCopyTimer)
    linkCopyTimer = setTimeout(() => { linkCopied.value = false }, 2000)
  } catch {
    linkCopyError.value = true
  }
}

// A sidebar taller than the viewport scrolls with the page and sticks at its
// top edge when scrolling up and at its bottom edge when scrolling down.
const topicAside = ref(null)
const ASIDE_TOP_GAP = 96
const ASIDE_BOTTOM_GAP = 24
let asideTop = ASIDE_TOP_GAP
let asideLastScrollY = 0
let asideFrame = 0
let asideResizeObserver = null

function updateAsideSticky() {
  asideFrame = 0
  const el = topicAside.value
  if (!el) return
  const scrollY = window.scrollY
  const delta = scrollY - asideLastScrollY
  asideLastScrollY = scrollY
  const minTop = Math.min(ASIDE_TOP_GAP, window.innerHeight - el.offsetHeight - ASIDE_BOTTOM_GAP)
  asideTop = Math.min(ASIDE_TOP_GAP, Math.max(minTop, asideTop - delta))
  el.style.setProperty('--topic-aside-top', `${asideTop}px`)
}

function scheduleAsideSticky() {
  if (!asideFrame) asideFrame = requestAnimationFrame(updateAsideSticky)
}

onMounted(() => {
  pageClassificationPollTimer = setInterval(() => { void pollPageClassification() }, 5000)
  asideLastScrollY = window.scrollY
  window.addEventListener('scroll', scheduleAsideSticky, { passive: true })
  window.addEventListener('resize', scheduleAsideSticky)
  if (typeof ResizeObserver !== 'undefined' && topicAside.value) {
    asideResizeObserver = new ResizeObserver(scheduleAsideSticky)
    asideResizeObserver.observe(topicAside.value)
  }
  scheduleAsideSticky()
})

onBeforeUnmount(() => {
  clearTimeout(linkCopyTimer)
  clearTimeout(aiRequestPollTimer)
  clearInterval(pageClassificationPollTimer)
  window.removeEventListener('scroll', scheduleAsideSticky)
  window.removeEventListener('resize', scheduleAsideSticky)
  asideResizeObserver?.disconnect()
  if (asideFrame) cancelAnimationFrame(asideFrame)
})
const revisionLabel = computed(() => topic.value?.revision_id ? t('topic.revisionNumber', { revision: topic.value.revision_id.slice(0, 8) }) : '')
const outline = computed(() => {
  const counts = new Map()
  let fence = null
  const headings = []
  for (const line of String(topic.value?.body_markdown || '').split('\n')) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (!fence) fence = marker
      else if (fence === marker) fence = null
      continue
    }
    if (fence) continue
    const match = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line.trim())
    if (!match) continue
    const text = match[2].replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/<[^>]*>/g, '').replace(/[*_~]/g, '')
    const baseId = slugifyHeading(text)
    const count = (counts.get(baseId) || 0) + 1
    counts.set(baseId, count)
    headings.push({ level: match[1].length, text, id: count === 1 ? baseId : `${baseId}-${count}` })
  }
  return headings
})
const pageNavigation = computed(() => {
  const sections = [
    ...(topic.value?.citations?.length ? [{ id: 'article-sources', text: t('topic.sources') }] : []),
    ...(Number(topic.value?.revision_count || 0) > 1 ? [{ id: 'article-history', text: t('topic.revisionHistory') }] : []),
    ...(topic.value?.kind === 'article' && Number(topic.value?.open_proposal_count || 0) > 0 ? [
      { id: 'article-proposals', text: t('topic.proposals') },
    ] : []),
    { id: 'article-activity', text: t('topic.activityTitle') },
    { id: 'article-discussion', text: t('topic.discussion') },
    ...(machineEndpoints.value.length ? [{ id: 'machine-endpoints', text: t('topic.machineEndpoints') }] : []),
  ]
  return [...outline.value, ...sections]
})

async function onTaskSolutionAccepted() {
  await refresh()
  activityTick.value += 1
}

async function scrollToPageNavigation(id, event) {
  event?.currentTarget?.closest('details')?.removeAttribute('open')
  if (id === 'article-history' || id === 'article-proposals') {
    revisionHistoryOpen.value = true
    await nextTick()
  }
  if (typeof document === 'undefined') return
  const target = document.getElementById(id)
  if (!target) return
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
  window.history?.replaceState?.(null, '', `${window.location.pathname}${window.location.search}#${id}`)
}

function slugifyHeading(text) {
  return String(text).normalize('NFKC').toLowerCase()
    .replace(/&(?:amp|lt|gt|quot|#39);/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section'
}

function kindLabel(kind) {
  return t(({ article: 'topics.articles', question: 'topics.questions', discussion: 'topics.discussions', message: 'topics.messages', page: 'topics.genericPage' })[kind] || 'topics.title')
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(value)) : ''
}

function formatDateTime(value) {
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''
}

function formatUtcStamp(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

useHead(() => ({
  htmlAttrs: topic.value?.locale ? { lang: topic.value.locale } : {},
  script: structuredData.value ? [{ key: 'article-jsonld', type: 'application/ld+json', children: structuredData.value }] : [],
  meta: [
    ...(publishedAtIso.value ? [{ property: 'article:published_time', content: publishedAtIso.value }] : []),
    ...(updatedAtIso.value ? [{ property: 'article:modified_time', content: updatedAtIso.value }] : []),
  ],
  link: [
    { rel: 'canonical', href: headUrl.value },
    ...(topic.value?.available_locales || []).map(code => ({ rel: 'alternate', hreflang: code, href: localizedUrl(code) })),
    ...(topic.value?.available_locales?.length > 1 ? [{ rel: 'alternate', hreflang: 'x-default', href: canonicalUrl.value }] : []),
    ...machineEndpoints.value.filter(endpoint => endpoint.label !== 'HTML' && endpoint.label !== 'Text').map(endpoint => ({
      rel: 'alternate',
      type: endpoint.label === 'Markdown' ? 'text/markdown' : endpoint.label === 'JSON' ? 'application/json' : 'application/ld+json',
      href: endpoint.absolute,
    })),
  ],
}))
useSeoMeta({
  title: () => topic.value ? `${topic.value.title} · AIKI` : 'Article · AIKI',
  description: () => topic.value?.summary || topic.value?.body_markdown?.replace(/[#>*_`\[\]()!-]/g, ' ').replace(/\s+/g, ' ').slice(0, 155) || 'An open knowledge page on AIKI.',
  ogType: 'article',
  ogTitle: () => topic.value?.title || 'AIKI article',
  ogDescription: () => topic.value?.summary || topic.value?.body_markdown?.slice(0, 155) || 'An open knowledge page on AIKI.',
  ogUrl: () => headUrl.value,
  ogSiteName: () => publisherName.value,
  ogLocale: () => OG_LOCALES[topic.value?.locale] || 'en_US',
  twitterCard: 'summary',
})
</script>

<style scoped>
.topic-stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  column-gap: 0;
  align-items: start;
  padding-inline: 0.75rem;
}

@media (min-width: 40rem) {
  .topic-stage {
    padding-inline: 1.5rem;
  }
}

.topic-lead {
  grid-column: 1;
  grid-row: 1;
  margin-bottom: 1.75rem;
}

.topic-overview-desktop {
  display: none;
}

.topic-overview-panel {
  position: relative;
  overflow: hidden;
  border: 1px solid #b8dcc3;
  border-radius: 1.5rem;
  background: #f0fbf4;
  padding: 1.25rem;
  box-shadow: 0 0.4rem 1.4rem rgb(37 91 57 / 8%);
  isolation: isolate;
}

.topic-overview-panel::before {
  position: absolute;
  inset: -55%;
  z-index: -1;
  border-radius: 50%;
  background: conic-gradient(from 90deg, transparent 0deg, rgb(87 174 116 / 0.22) 90deg, transparent 170deg, rgb(61 132 87 / 0.2) 260deg, transparent 360deg);
  content: '';
  filter: blur(1.1rem);
  opacity: 0.9;
  animation: topic-overview-glow 18s linear infinite;
}

.topic-overview-toggle {
  position: relative;
  z-index: 1;
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: #174d3b;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-align: start;
  text-transform: uppercase;
}

.topic-overview-toggle:focus-visible {
  outline: 2px solid #3d8a5b;
  outline-offset: 0.3rem;
}

.topic-overview-chevron {
  flex: none;
  width: 1rem;
  height: 1rem;
  transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
}

.topic-overview-chevron.is-expanded { transform: rotate(180deg); }

.topic-overview-body {
  position: relative;
  z-index: 1;
  max-height: 7.8rem;
  overflow: hidden;
  opacity: 0.94;
  transition: max-height 700ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease;
}

.topic-overview-compact .topic-overview-body { max-height: 5.8rem; }

.topic-overview-panel.is-expanded .topic-overview-body {
  max-height: 60rem;
  opacity: 1;
}

.topic-overview-body-inner {
  padding-top: 0.55rem;
}

.topic-overview-copy { overflow-wrap: anywhere; }

@keyframes topic-overview-glow {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .topic-overview-panel::before,
  .topic-overview-chevron,
  .topic-overview-body { animation: none; transition: none; }
}

.topic-main {
  grid-column: 1;
  grid-row: 2;
}

.topic-main h1 {
  overflow-wrap: anywhere;
  hyphens: auto;
  text-wrap: balance;
}

.topic-aside {
  grid-column: 1;
  grid-row: 3;
  margin-top: 2.25rem;
}

@media (min-width: 80rem) {
  .topic-stage {
    grid-template-columns:
      minmax(19rem, 1fr)
      minmax(36rem, min(44rem, calc(100% - 42rem)))
      minmax(19rem, 1fr);
    column-gap: 2rem;
  }

  .topic-lead,
  .topic-main {
    grid-column: 2;
  }

  .topic-overview-desktop {
    display: block;
    grid-column: 1;
    grid-row: 2;
    width: min(19rem, 100%);
    justify-self: end;
    align-self: start;
    height: fit-content;
    /* Not sticky, but still the containing block of the animated glow (::before). */
    position: relative !important;
  }

  .topic-aside {
    grid-column: 3;
    grid-row: 2;
    width: min(19rem, 100%);
    margin-top: 0;
    justify-self: start;
    align-self: start;
    height: fit-content;
    position: sticky !important;
    top: var(--topic-aside-top, 6rem) !important;
    transform: none;
  }

  .article-reading .prose-aiki {
    font-family: 'PF Regal', 'PF Regal Text Pro', Georgia, serif;
  }

  .topic-toc-compact {
    display: none;
  }
}
</style>
