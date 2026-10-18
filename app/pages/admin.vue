<template>
  <section class="mx-auto max-w-3xl">
    <div class="flex flex-wrap gap-x-4 gap-y-1">
      <BackLink to="/account">{{ t('admin.backToAccount') }}</BackLink>
      <BackLink to="/node">{{ t('admin.backToNode') }}</BackLink>
    </div>
    <p class="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">{{ t('admin.eyebrow') }}</p>
    <h1 class="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">{{ t('admin.title') }}</h1>
    <p class="mt-3 max-w-2xl leading-7 text-zinc-600">{{ t('admin.description') }}</p>
    <section v-if="settings" data-testid="admin-issues" class="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-zinc-950">{{ t('admin.issuesTitle') }}</h2>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">{{ t('admin.issuesHint') }}</p>
      <div class="mt-4 flex flex-wrap gap-3">
        <a data-testid="admin-bug-report" class="aiki-button inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold" :href="bugReportUrl" target="_blank" rel="noreferrer">{{ t('admin.bugReport') }}</a>
        <a data-testid="admin-feature-proposal" class="inline-flex rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50" :href="featureProposalUrl" target="_blank" rel="noreferrer">{{ t('admin.featureProposal') }}</a>
      </div>
    </section>
    <p v-if="settings && release?.updateAvailable" data-testid="admin-update" role="status" class="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">{{ t('admin.updateAvailable', { latest: release.hubVersion, current: release.version }) }}</p>

    <section v-if="settings" data-testid="admin-analytics" class="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
      <button type="button" data-testid="admin-analytics-toggle" class="group flex w-full items-start justify-between gap-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-4" :aria-expanded="analyticsExpanded" aria-controls="admin-analytics-content" @click="analyticsExpanded = !analyticsExpanded">
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-zinc-950">{{ t('admin.analyticsTitle') }}</span>
          <span class="mt-2 block max-w-2xl text-sm leading-6 text-zinc-500">{{ t('admin.analyticsHint', { days: analytics?.retentionDays || 30 }) }}</span>
        </span>
        <UIcon name="i-lucide-chevron-down" class="mt-1 size-5 shrink-0 text-zinc-500 transition-transform duration-200 group-hover:text-zinc-900" :class="analyticsExpanded ? 'rotate-180' : ''" aria-hidden="true" />
      </button>

      <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="-translate-y-2 opacity-0" enter-to-class="translate-y-0 opacity-100" leave-active-class="transition duration-150 ease-in" leave-from-class="translate-y-0 opacity-100" leave-to-class="-translate-y-2 opacity-0">
        <div v-if="analyticsExpanded" id="admin-analytics-content" class="overflow-hidden">
          <div class="mt-5 flex flex-wrap items-end justify-between gap-3">
            <label class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('admin.analyticsPeriod') }}
              <select v-model="analyticsDays" data-testid="admin-analytics-days" class="mt-1 block rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-800">
                <option value="1">1 {{ t('admin.analyticsDays') }}</option>
                <option value="7">7 {{ t('admin.analyticsDays') }}</option>
                <option value="30">30 {{ t('admin.analyticsDays') }}</option>
              </select>
            </label>
            <button type="button" data-testid="admin-analytics-refresh" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60" :disabled="analyticsPending" @click="refreshAnalytics">{{ t('admin.analyticsRefresh') }}</button>
          </div>

          <p v-if="analyticsPending" role="status" class="mt-5 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-500">{{ t('admin.analyticsLoading') }}</p>
          <p v-else-if="analyticsFetchError" role="alert" class="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{{ t('admin.analyticsUnavailable') }}</p>
          <template v-else-if="analytics">
            <dl class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div v-for="card in analyticsCards" :key="card.key" class="rounded-xl bg-zinc-50 p-4">
                <dt class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ card.label }}</dt>
                <dd class="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">{{ formatCount(card.value) }}</dd>
              </div>
            </dl>

            <div class="mt-6 grid gap-4 md:grid-cols-2">
              <section v-for="group in analyticsGroups" :key="group.key" class="rounded-xl border border-zinc-200 p-4">
                <h3 class="text-sm font-semibold text-zinc-950">{{ group.title }}</h3>
                <div class="mt-3 overflow-x-auto">
                  <table class="w-full min-w-[18rem] text-left text-sm">
                    <thead class="text-xs uppercase tracking-wide text-zinc-500">
                      <tr><th class="pb-2 font-semibold">{{ t('admin.analyticsClient') }}</th><th class="pb-2 text-right font-semibold">{{ t('admin.analyticsUnique') }}</th><th class="pb-2 text-right font-semibold">{{ t('admin.analyticsHits') }}</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="item in group.items" :key="item.label" class="border-t border-zinc-100">
                        <td class="py-2 pr-3 text-zinc-800">{{ item.label }}</td><td class="py-2 text-right tabular-nums text-zinc-600">{{ formatCount(item.uniqueVisitors) }}</td><td class="py-2 text-right tabular-nums text-zinc-600">{{ formatCount(item.hits) }}</td>
                      </tr>
                      <tr v-if="!group.items.length"><td colspan="3" class="py-3 text-zinc-500">{{ t('admin.analyticsNoData') }}</td></tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <section class="mt-6 rounded-xl border border-zinc-200 p-4">
              <h3 class="text-sm font-semibold text-zinc-950">{{ t('admin.analyticsTopPages') }}</h3>
              <div class="mt-3 overflow-x-auto">
                <table class="w-full min-w-[32rem] text-left text-sm">
                  <thead class="text-xs uppercase tracking-wide text-zinc-500"><tr><th class="pb-2 font-semibold">{{ t('admin.analyticsMaterial') }}</th><th class="pb-2 text-right font-semibold">{{ t('admin.analyticsUnique') }}</th><th class="pb-2 text-right font-semibold">{{ t('admin.analyticsHits') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="page in analytics.topPages" :key="page.path" class="border-t border-zinc-100">
                      <td class="max-w-[28rem] py-2 pr-3"><a :href="page.path" class="font-medium text-emerald-900 underline-offset-2 hover:underline">{{ page.title || page.path }}</a><span class="ml-2 text-xs text-zinc-400">{{ page.path }}</span></td><td class="py-2 text-right tabular-nums text-zinc-600">{{ formatCount(page.uniqueVisitors) }}</td><td class="py-2 text-right tabular-nums text-zinc-600">{{ formatCount(page.hits) }}</td>
                    </tr>
                    <tr v-if="!analytics.topPages.length"><td colspan="3" class="py-3 text-zinc-500">{{ t('admin.analyticsNoData') }}</td></tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section class="mt-6 rounded-xl border border-zinc-200 p-4">
              <h3 class="text-sm font-semibold text-zinc-950">{{ t('admin.analyticsRecent') }}</h3>
              <div class="mt-3 overflow-x-auto">
                <table class="w-full min-w-[60rem] text-left text-sm">
                  <thead class="text-xs uppercase tracking-wide text-zinc-500"><tr><th class="pb-2 font-semibold">{{ t('admin.analyticsIp') }}</th><th class="pb-2 font-semibold">{{ t('admin.analyticsCountry') }}</th><th class="pb-2 font-semibold">{{ t('admin.analyticsClient') }}</th><th class="pb-2 font-semibold">{{ t('admin.analyticsDevice') }}</th><th class="pb-2 font-semibold">{{ t('admin.analyticsBrowser') }}</th><th class="pb-2 font-semibold">{{ t('admin.analyticsMaterial') }}</th><th class="pb-2 font-semibold">{{ t('admin.analyticsLastSeen') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="row in analytics.recent" :key="`${row.ip}-${row.path}`" class="border-t border-zinc-100 align-top">
                       <td class="py-2 pr-3 font-mono text-xs text-zinc-800">{{ row.ip }}</td><td class="py-2 pr-3 text-zinc-600">{{ row.country }}</td><td class="py-2 pr-3"><span class="font-medium text-zinc-800">{{ row.label }}</span><span class="ml-1 text-xs text-zinc-500">({{ row.kind === 'bot' ? t('admin.analyticsBot') : row.kind === 'agent' ? t('admin.analyticsAgent') : t('admin.analyticsHuman') }})</span></td><td class="py-2 pr-3 text-zinc-600">{{ row.device }} · {{ row.os }}</td><td class="py-2 pr-3 text-zinc-600">{{ row.browser }}</td><td class="py-2 pr-3 text-zinc-600">{{ row.path }} <span class="text-xs text-zinc-400">×{{ formatCount(row.hits) }}</span></td><td class="whitespace-nowrap py-2 text-zinc-600">{{ formatAnalyticsTime(row.lastSeenAt) }}</td>
                    </tr>
                    <tr v-if="!analytics.recent.length"><td colspan="7" class="py-3 text-zinc-500">{{ t('admin.analyticsNoData') }}</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          </template>
        </div>
      </Transition>
    </section>

    <section v-if="settings" data-testid="admin-access-control" class="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-zinc-950">{{ t('admin.accessControlTitle') }}</h2>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">{{ t('admin.accessControlHint') }}</p>
      <fieldset class="mt-5 grid gap-3 sm:grid-cols-3">
        <legend class="sr-only">{{ t('admin.accessControlTitle') }}</legend>
        <label class="flex items-start gap-2 rounded-xl border border-zinc-200 p-3 text-sm text-zinc-800">
          <input v-model="accessBlockThreat" data-testid="access-block-threat" type="checkbox" class="mt-1 accent-emerald-700" :disabled="saving" @change="autoSave('access')">
          <span><span class="font-semibold">{{ t('admin.accessControlThreat') }}</span><span class="mt-1 block text-xs leading-5 text-zinc-500">{{ t('admin.accessControlThreatHint') }}</span></span>
        </label>
        <label class="flex items-start gap-2 rounded-xl border border-zinc-200 p-3 text-sm text-zinc-800">
          <input v-model="accessBlockDatacenter" data-testid="access-block-datacenter" type="checkbox" class="mt-1 accent-emerald-700" :disabled="saving" @change="autoSave('access')">
          <span><span class="font-semibold">{{ t('admin.accessControlDatacenter') }}</span><span class="mt-1 block text-xs leading-5 text-zinc-500">{{ t('admin.accessControlDatacenterHint') }}</span></span>
        </label>
        <label class="flex items-start gap-2 rounded-xl border border-zinc-200 p-3 text-sm text-zinc-800">
          <input v-model="accessBlockScanner" data-testid="access-block-scanner" type="checkbox" class="mt-1 accent-emerald-700" :disabled="saving" @change="autoSave('access')">
          <span><span class="font-semibold">{{ t('admin.accessControlScanner') }}</span><span class="mt-1 block text-xs leading-5 text-zinc-500">{{ t('admin.accessControlScannerHint') }}</span></span>
        </label>
      </fieldset>
      <p class="mt-3 text-xs leading-5" :class="autoSaveState.access === 'error' ? 'text-red-700' : autoSaveState.access === 'saved' ? 'text-emerald-700' : 'text-zinc-500'" role="status" data-testid="access-autosave-status">{{ autoSaveText('access') }}</p>

      <div class="mt-6 border-t border-zinc-100 pt-5">
        <h3 class="text-sm font-semibold text-zinc-950">{{ t('admin.accessControlCustomTitle') }}</h3>
        <p class="mt-1 text-sm leading-6 text-zinc-500">{{ t('admin.accessControlCustomHint') }}</p>
        <div v-if="accessBlocks.length" class="mt-4 space-y-2">
          <div v-for="block in accessBlocks" :key="block.id" class="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <div class="min-w-0 text-sm">
              <code class="font-mono font-semibold text-zinc-900">{{ block.ip }}</code>
              <p v-if="block.reason" class="mt-1 break-words text-zinc-600">{{ block.reason }}</p>
              <p class="mt-1 text-xs text-zinc-500">
                <span v-if="block.statica?.country">{{ t('admin.accessControlCountry') }}: {{ block.statica.country }}</span>
                <span v-if="block.statica?.country && accessStaticaLabels(block).length"> · </span>
                <span v-if="accessStaticaLabels(block).length">Statica: {{ accessStaticaLabels(block).join(', ') }}</span>
                <span v-if="!block.statica?.country && !accessStaticaLabels(block).length">{{ t('admin.accessControlNoStatica') }}</span>
              </p>
            </div>
            <button type="button" class="shrink-0 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-60" :disabled="accessActionPending" @click="removeAccessBlock(block.id)">{{ t('admin.accessControlRemove') }}</button>
          </div>
        </div>
        <p v-else class="mt-4 text-sm text-zinc-500">{{ t('admin.accessControlCustomEmpty') }}</p>
        <div class="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label class="text-sm font-medium text-zinc-700">{{ t('admin.accessControlIp') }}
            <input v-model="accessIp" data-testid="access-block-ip" type="text" inputmode="numeric" maxlength="64" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 font-mono text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" placeholder="203.0.113.10">
          </label>
          <label class="text-sm font-medium text-zinc-700">{{ t('admin.accessControlReason') }}
            <input v-model="accessReason" data-testid="access-block-reason" type="text" maxlength="240" class="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" :placeholder="t('admin.accessControlReasonPlaceholder')">
          </label>
          <button type="button" data-testid="access-block-add" class="aiki-button rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60" :disabled="accessActionPending || !accessIp.trim()" @click="addAccessBlock">{{ t('admin.accessControlAdd') }}</button>
        </div>
        <p v-if="accessActionError" role="alert" class="mt-3 text-sm text-rose-800">{{ accessActionError }}</p>
      </div>
    </section>

    <p v-if="pending" role="status" class="mt-8 rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">{{ t('topics.loading') }}</p>
    <div v-else-if="statusCode === 401" role="alert" class="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
      <p>{{ t('admin.signInRequired') }}</p>
      <NuxtLink to="/login" class="mt-3 inline-flex font-semibold text-emerald-900 underline">{{ t('auth.signIn') }}</NuxtLink>
    </div>
    <p v-else-if="statusCode === 403" role="alert" data-testid="admin-forbidden" class="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">{{ t('admin.forbidden') }}</p>
    <p v-else-if="error || !settings" role="alert" class="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">{{ t('admin.unavailable') }}</p>

    <form v-else class="mt-8 space-y-6 rounded-2xl border border-zinc-200 bg-white p-6" @submit.prevent="save">
      <fieldset class="space-y-4">
        <legend class="text-sm font-semibold text-zinc-950">{{ t('admin.brandTitle') }}</legend>
        <p class="text-sm leading-6 text-zinc-500">{{ t('admin.brandHint') }}</p>
        <div data-testid="node-brand-preview" class="flex items-center gap-3 rounded-xl bg-zinc-50 p-3">
          <img :src="previewSrc" alt="" width="44" height="40" class="h-10 w-11 shrink-0 object-contain">
          <img v-if="previewName === 'AiKi'" src="/aiki-wordmark.svg" alt="" width="64" height="40" class="aiki-wordmark h-10 w-16 shrink-0">
          <span v-else class="truncate font-serif text-xl text-zinc-950">{{ previewName }}</span>
        </div>
        <label class="block text-sm font-medium text-zinc-800">{{ t('admin.nameLabel') }}
          <input v-model="displayName" data-testid="node-display-name" maxlength="40" class="mt-1.5 w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" :placeholder="t('admin.namePlaceholder')">
        </label>
        <label class="block text-sm font-medium text-zinc-800">{{ t('admin.iconLabel') }}
          <input ref="iconInput" data-testid="node-icon-file" type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp,.svg" class="mt-1.5 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-zinc-800" @change="chooseIcon">
        </label>
        <p class="text-sm text-zinc-500">{{ t('admin.iconHint') }}</p>
        <button v-if="settings.iconUrl || localPreview" type="button" class="text-sm font-semibold text-emerald-900 underline" data-testid="node-icon-default" @click="restoreIcon">{{ t('admin.iconDefault') }}</button>
        <p v-if="iconError" role="alert" class="text-sm text-amber-800">{{ iconError }}</p>
      </fieldset>
      <fieldset data-testid="admin-favicon" class="space-y-4">
        <legend class="text-sm font-semibold text-zinc-950">{{ t('admin.faviconTitle') }}</legend>
        <p class="text-sm leading-6 text-zinc-500">{{ t('admin.faviconHint') }}</p>
        <div data-testid="node-favicon-preview" class="flex items-center gap-3 rounded-xl bg-zinc-50 p-3">
          <img :src="faviconPreviewSrc" alt="" width="44" height="44" class="size-11 rounded-xl bg-white object-contain">
        </div>
        <label class="block text-sm font-medium text-zinc-800">{{ t('admin.faviconLabel') }}
          <input ref="faviconInput" data-testid="node-favicon-file" type="file" accept="image/png,image/jpeg,image/webp" class="mt-1.5 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-zinc-800" @change="chooseFavicon">
        </label>
        <button v-if="settings.faviconUrl || faviconPreview" type="button" class="text-sm font-semibold text-emerald-900 underline" data-testid="node-favicon-default" @click="restoreFavicon">{{ t('admin.faviconDefault') }}</button>
        <p v-if="faviconError" role="alert" class="text-sm text-amber-800">{{ faviconError }}</p>
      </fieldset>
      <fieldset class="space-y-4">
        <legend class="text-sm font-semibold text-zinc-950">{{ t('admin.accentTitle') }}</legend>
        <p class="text-sm leading-6 text-zinc-500">{{ t('admin.accentHint') }}</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="rounded-xl bg-zinc-50 p-4">
            <label class="block text-sm font-medium text-zinc-800" for="accent-light">{{ t('admin.accentLight') }}</label>
            <div class="mt-2 flex items-center gap-3">
              <input id="accent-light" data-testid="accent-light" type="color" :value="accentLight" class="h-11 w-14 cursor-pointer rounded-lg border border-zinc-200 bg-white p-1" @input="setAccent('light', $event.target.value)">
              <code class="text-sm text-zinc-600">{{ accentLight }}</code>
            </div>
            <span class="mt-3 inline-flex rounded-xl px-4 py-2 text-sm font-semibold" :style="previewStyle(accentLight)">{{ t('admin.accentPreview') }}</span>
          </div>
          <div class="rounded-xl bg-zinc-900 p-4">
            <label class="block text-sm font-medium text-zinc-100" for="accent-dark">{{ t('admin.accentDark') }}</label>
            <div class="mt-2 flex items-center gap-3">
              <input id="accent-dark" data-testid="accent-dark" type="color" :value="accentDark" class="h-11 w-14 cursor-pointer rounded-lg border border-zinc-600 bg-zinc-800 p-1" @input="setAccent('dark', $event.target.value)">
              <code class="text-sm text-zinc-300">{{ accentDark }}</code>
            </div>
            <span class="mt-3 inline-flex rounded-xl px-4 py-2 text-sm font-semibold" :style="previewStyle(accentDark)">{{ t('admin.accentPreview') }}</span>
          </div>
        </div>
        <button type="button" class="text-sm font-semibold text-emerald-900 underline" @click="resetAccents">{{ t('admin.accentReset') }}</button>
        <p v-if="accentError" role="alert" class="text-sm text-amber-800">{{ t('admin.accentInvalid') }}</p>
      </fieldset>
      <div class="flex items-start gap-3 text-sm leading-6 text-zinc-800">
        <button
          id="registration-open"
          type="button"
          role="switch"
          data-testid="registration-open-toggle"
          :aria-checked="registrationOpen"
          aria-labelledby="registration-open-label"
          class="mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          :class="registrationOpen ? '' : 'bg-zinc-300'"
          :style="registrationOpen ? { backgroundColor: 'var(--aiki-accent)' } : undefined"
          @click="registrationOpen = !registrationOpen"
        >
          <span class="size-5 rounded-full bg-white shadow transition" :class="registrationOpen ? 'translate-x-5' : 'translate-x-0'"></span>
        </button>
        <div id="registration-open-label">
          <p class="font-semibold">{{ t('admin.registrationLabel') }}</p>
          <p class="mt-1 text-zinc-500">{{ t('admin.registrationHint') }}</p>
        </div>
      </div>
      <div class="flex items-start gap-3 text-sm leading-6 text-zinc-800">
        <button
          id="counts-public"
          type="button"
          role="switch"
          data-testid="counts-public-toggle"
          :aria-checked="countsPublic"
          :aria-labelledby="'counts-public-label'"
          class="mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          :class="countsPublic ? '' : 'bg-zinc-300'"
          :style="countsPublic ? { backgroundColor: 'var(--aiki-accent)' } : undefined"
          @click="countsPublic = !countsPublic"
        >
          <span class="size-5 rounded-full bg-white shadow transition" :class="countsPublic ? 'translate-x-5' : 'translate-x-0'"></span>
        </button>
        <div id="counts-public-label">
          <p class="font-semibold">{{ t('admin.countsLabel') }}</p>
          <p class="mt-1 text-zinc-500">{{ t('admin.countsHint') }}</p>
        </div>
      </div>
      <fieldset data-testid="admin-federation" class="admin-federation space-y-4 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
        <legend class="px-1 text-sm font-semibold text-zinc-950">{{ t('admin.federationTitle') }}</legend>
        <p class="text-sm leading-6 text-zinc-600">{{ t('admin.federationHint') }}</p>
        <p v-if="settings.federation && !settings.federation.ready && !federationEnabled" class="rounded-lg bg-amber-100 p-3 text-xs leading-5 text-amber-900">{{ t('admin.federationNotReady') }}</p>
        <div class="flex items-start gap-3 text-sm leading-6 text-zinc-800">
          <button
            type="button"
            role="switch"
            data-testid="federation-enabled"
            :aria-checked="federationEnabled"
            aria-labelledby="federation-enabled-label"
            :disabled="saving"
            class="mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-60"
            :class="federationEnabled ? '' : 'bg-zinc-300'"
            :style="federationEnabled ? { backgroundColor: 'var(--aiki-accent)' } : undefined"
            @click="toggleFederation"
          >
            <span class="size-5 rounded-full bg-white shadow transition" :class="federationEnabled ? 'translate-x-5' : 'translate-x-0'"></span>
          </button>
          <p id="federation-enabled-label" class="font-semibold">{{ t('admin.federationEnabled') }}</p>
        </div>
        <label class="block text-sm font-medium text-zinc-800">{{ t('admin.federationMode') }}
          <select v-model="federationMode" data-testid="federation-mode" :disabled="!federationEnabled || saving" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 disabled:opacity-60" @change="autoSave('federation')">
            <option value="open">{{ t('admin.federationModeOpen') }}</option>
            <option value="inbound_only">{{ t('admin.federationModeInbound') }}</option>
            <option value="outbound_only">{{ t('admin.federationModeOutbound') }}</option>
            <option value="paused">{{ t('admin.federationModePaused') }}</option>
          </select>
        </label>
        <p v-if="autoSaveState.federation" class="text-xs leading-5" :class="autoSaveState.federation === 'error' ? 'text-red-700' : autoSaveState.federation === 'saved' ? 'text-emerald-700' : 'text-zinc-500'" role="status" data-testid="federation-autosave-status">{{ autoSaveText('federation') }}</p>
        <p v-if="settings.federation?.lastError" class="rounded-lg bg-amber-100 p-3 text-xs leading-5 text-amber-900">{{ settings.federation.lastError }}</p>
      </fieldset>

      <fieldset data-testid="admin-article-rules" class="space-y-4">
        <legend class="text-sm font-semibold text-zinc-950">{{ t('rules.adminTitle') }}</legend>
        <p class="text-sm leading-6 text-zinc-500">{{ t('rules.adminHint') }}</p>
        <div v-for="rule in baselineRules" :key="rule.id" class="rounded-xl bg-zinc-50 p-3">
          <p class="text-sm leading-6 text-zinc-800">{{ rule.statement }}</p>
          <label class="mt-2 block text-sm font-medium text-zinc-700">{{ rule.id }}
            <select v-model="ruleChoices[rule.id]" :data-testid="`article-rule-${rule.id}`" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2">
              <option value="keep">{{ t('rules.keep') }}</option>
              <option value="allow">{{ t('rules.allow') }}</option>
              <option value="replace">{{ t('rules.replace') }}</option>
            </select>
          </label>
          <div v-if="ruleChoices[rule.id] === 'replace'" class="mt-2 grid gap-2">
            <label class="text-sm text-zinc-700">{{ t('rules.statement') }}
              <textarea v-model="replacements[rule.id].statement" maxlength="400" rows="2" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"></textarea>
            </label>
            <label class="text-sm text-zinc-700">{{ t('rules.match') }}
              <input v-model="replacements[rule.id].match" maxlength="80" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2">
            </label>
          </div>
        </div>
        <div v-for="(extra, index) in extraRules" :key="index" class="rounded-xl border border-zinc-200 p-3">
          <label class="block text-sm font-medium text-zinc-700">
            <select v-model="extra.effect" class="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2">
              <option value="forbid">{{ t('rules.forbid') }}</option>
              <option value="add">{{ t('rules.add') }}</option>
            </select>
          </label>
          <label class="mt-2 block text-sm text-zinc-700">{{ t('rules.statement') }}
            <textarea v-model="extra.statement" maxlength="400" rows="2" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"></textarea>
          </label>
          <label class="mt-2 block text-sm text-zinc-700">{{ t('rules.match') }}
            <input v-model="extra.match" data-testid="article-rule-extra-match" maxlength="80" class="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2">
          </label>
          <button type="button" class="mt-2 text-sm font-semibold text-emerald-900 underline" @click="extraRules.splice(index, 1)">{{ t('rules.remove') }}</button>
        </div>
        <button type="button" data-testid="article-rule-add" class="text-sm font-semibold text-emerald-900 underline" @click="extraRules.push({ effect: 'forbid', statement: '', match: '' })">{{ t('rules.addRule') }}</button>
      </fieldset>

      <dl data-testid="admin-counts" class="grid gap-4 sm:grid-cols-3">
        <div class="rounded-xl bg-zinc-50 p-4">
          <dt class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('node.pagesLabel') }}</dt>
          <dd class="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">{{ formatCount(settings.pages) }}</dd>
        </div>
        <div class="rounded-xl bg-zinc-50 p-4">
          <dt class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('node.humansLabel') }}</dt>
          <dd class="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">{{ formatCount(settings.users) }}</dd>
        </div>
        <div class="rounded-xl bg-zinc-50 p-4">
          <dt class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('node.agentsLabel') }}</dt>
          <dd class="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">{{ formatCount(settings.agents ?? 0) }}</dd>
        </div>
      </dl>

      <fieldset data-testid="admin-moderation" class="space-y-3">
        <legend class="text-sm font-semibold text-zinc-950">{{ t('moderation.adminTitle') }}</legend>
        <p class="text-sm leading-6 text-zinc-500">{{ t('moderation.adminHint') }}</p>
        <label class="flex items-start gap-2 text-sm leading-6 text-zinc-800">
          <input v-model="moderationMode" data-testid="moderation-community" type="radio" value="community" class="mt-1">
          <span>{{ t('moderation.community') }}</span>
        </label>
        <label class="flex items-start gap-2 text-sm leading-6 text-zinc-800">
          <input v-model="moderationMode" data-testid="moderation-manual" type="radio" value="manual" class="mt-1">
          <span><span class="font-semibold">{{ t('moderation.manual') }}.</span> {{ t('moderation.manualNote') }}</span>
        </label>
      </fieldset>

      <fieldset data-testid="admin-ai-settings" class="space-y-5 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 sm:p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <legend class="px-1 text-base font-semibold text-zinc-950 dark:text-zinc-50">{{ t('admin.aiSettingsTitle') }}</legend>
        <p class="text-sm leading-6 text-zinc-500 dark:text-zinc-300">{{ t('admin.aiSettingsHint') }}</p>

      <fieldset data-testid="admin-model-check" class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800/70">
        <legend class="text-sm font-semibold text-zinc-950 dark:text-zinc-100">{{ t('admin.moderationProviderTitle') }}</legend>
        <p class="text-sm leading-6 text-zinc-500 dark:text-zinc-300">{{ t('admin.moderationProviderHint') }}</p>
        <label class="flex items-start gap-2 text-sm leading-6 text-zinc-800 dark:text-zinc-100">
          <input v-model="modelEnabled" data-testid="node-model-enabled" type="checkbox" class="mt-1 accent-emerald-700">
          <span>{{ t('moderation.nodeModelEnabled') }}</span>
        </label>
        <div v-if="modelEnabled" class="grid gap-3 sm:grid-cols-2">
          <label class="text-sm text-zinc-700 dark:text-zinc-200">{{ t('moderation.provider') }}
            <select v-model="modelProvider" data-testid="node-model-provider" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
              <option value="openrouter">{{ t('moderation.openrouter') }}</option>
              <option value="openai">{{ t('moderation.openai') }}</option>
              <option value="neron">{{ t('moderation.neron') }}</option>
            </select>
          </label>
          <label class="text-sm text-zinc-700 dark:text-zinc-200">{{ t('moderation.model') }}
            <input v-model="modelName" data-testid="node-model-name" maxlength="120" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500">
          </label>
          <label v-if="modelProvider === 'neron'" class="text-sm text-zinc-700 dark:text-zinc-200 sm:col-span-2">{{ t('moderation.endpoint') }}
            <input v-model="modelEndpoint" data-testid="node-model-endpoint" type="url" autocomplete="off" maxlength="500" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500" :placeholder="t('moderation.endpointPlaceholder')">
          </label>
          <label class="text-sm text-zinc-700 dark:text-zinc-200 sm:col-span-2">{{ t('moderation.key') }}
            <input v-model="modelKey" data-testid="node-model-key" type="password" autocomplete="off" maxlength="400" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500">
          </label>
          <p v-if="modelKeySet" class="text-xs leading-5 text-zinc-500 dark:text-zinc-400 sm:col-span-2">{{ t('moderation.keySet') }}</p>
          <label class="text-sm text-zinc-700 dark:text-zinc-200 sm:col-span-2">{{ t('moderation.onFail') }}
            <select v-model="modelOnFail" data-testid="node-model-on-fail" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
              <option value="unlisted">{{ t('moderation.failUnlisted') }}</option>
              <option value="hidden">{{ t('moderation.failHidden') }}</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset data-testid="admin-agent-provider" class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800/70">
        <legend class="text-sm font-semibold text-zinc-950 dark:text-zinc-100">{{ t('admin.agentProviderTitle') }}</legend>
        <p class="text-sm leading-6 text-zinc-500 dark:text-zinc-300">{{ t('admin.agentProviderHint') }}</p>
        <label class="block text-sm text-zinc-700 dark:text-zinc-200">{{ t('admin.agentProviderMode') }}
          <select v-model="agentProviderMode" data-testid="agent-provider-mode" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            <option value="disabled">{{ t('admin.agentProviderDisabled') }}</option>
            <option value="neron">{{ t('admin.agentProviderNeron') }}</option>
            <option value="aiki_cloud">{{ t('admin.agentProviderCloud') }}</option>
            <option value="custom">{{ t('admin.agentProviderCustom') }}</option>
          </select>
        </label>
        <p v-if="agentProviderMode === 'aiki_cloud'" class="rounded-xl bg-zinc-50 p-3 text-sm leading-6 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{{ t('admin.agentProviderCloudHint') }}</p>
        <section v-if="agentProviderMode === 'aiki_cloud' || agentProviderMode === 'neron'" data-testid="agent-provider-billing" class="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ t('admin.agentProviderBalanceTitle') }}</h3>
              <p class="mt-1 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50" data-testid="agent-provider-balance">
                {{ agentBilling?.balance !== null && agentBilling?.balance !== undefined ? `${formatCount(agentBilling.balance)} ${agentBilling.ticker || (agentProviderMode === 'aiki_cloud' ? 'WPG' : 'NAI')}` : '—' }}
              </p>
              <p class="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{{ agentProviderMode === 'aiki_cloud' ? t('admin.agentProviderBalanceWpg') : t('admin.agentProviderBalanceNai') }}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button v-if="agentProviderMode === 'aiki_cloud'" type="button" class="aiki-button rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50" :disabled="!agentBilling?.topUpUrl" @click="openAgentTopUp">{{ t('admin.agentProviderTopUp') }}</button>
              <button type="button" data-testid="agent-provider-balance-refresh" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800" :disabled="agentBillingLoading" @click="refreshAgentBilling">{{ t('admin.agentProviderBalanceRefresh') }}</button>
            </div>
          </div>
          <p v-if="agentBillingStatusText" class="mt-3 text-xs leading-5 text-zinc-400">{{ agentBillingStatusText }}</p>
        </section>
        <div v-if="agentProviderMode !== 'disabled'" class="grid gap-3 sm:grid-cols-2">
          <label v-if="agentProviderMode !== 'aiki_cloud'" class="text-sm text-zinc-700 dark:text-zinc-200 sm:col-span-2">{{ t('admin.agentProviderEndpoint') }}
            <input v-model="agentProviderEndpoint" data-testid="agent-provider-endpoint" type="url" autocomplete="off" maxlength="500" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500" placeholder="https://">
          </label>
          <label v-if="agentProviderMode !== 'aiki_cloud'" class="text-sm text-zinc-700 dark:text-zinc-200 sm:col-span-2">{{ t('admin.agentProviderKey') }}
            <input v-model="agentProviderKey" data-testid="agent-provider-key" type="password" autocomplete="off" maxlength="400" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500">
          </label>
          <p v-if="agentProviderMode !== 'aiki_cloud' && agentProviderKeySet" class="text-xs leading-5 text-zinc-500 dark:text-zinc-400 sm:col-span-2">{{ t('admin.agentProviderKeySet') }}</p>
          <template v-if="agentProviderMode !== 'disabled'">
            <label class="text-sm text-zinc-700 dark:text-zinc-200">{{ t('admin.agentProviderModel') }}
              <input v-model="agentProviderModel" data-testid="agent-provider-model" maxlength="160" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500" :placeholder="t('admin.agentProviderModelPlaceholder')">
            </label>
            <label class="text-sm text-zinc-700 dark:text-zinc-200">{{ t('admin.agentProviderFastModel') }}
              <input v-model="agentProviderFastModel" data-testid="agent-provider-fast-model" maxlength="160" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500" :placeholder="t('admin.agentProviderFastModelPlaceholder')">
              <span class="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">{{ t('admin.agentProviderFastModelHint') }}</span>
            </label>
          </template>
          <template v-if="agentProviderMode === 'custom'">
            <label class="text-sm text-zinc-700 dark:text-zinc-200">{{ t('admin.agentProviderFormat') }}
              <select v-model="agentProviderFormat" data-testid="agent-provider-format" class="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
                <option value="task_json">{{ t('admin.agentProviderFormatTask') }}</option>
                <option value="openai_chat">{{ t('admin.agentProviderFormatChat') }}</option>
                <option value="openai_responses">{{ t('admin.agentProviderFormatResponses') }}</option>
              </select>
            </label>
          </template>
        </div>
      </fieldset>
      </fieldset>

      <p v-if="saveError" role="alert" class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ t('admin.saveFailed') }}</p>
      <p v-if="saved" role="status" data-testid="admin-saved" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{{ t('admin.saved') }}</p>
      <button type="submit" class="aiki-button rounded-xl px-4 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-60" :disabled="saving">{{ saving ? t('admin.saving') : t('admin.save') }}</button>
    </form>

    <section v-if="settings" data-testid="moderation-queue" class="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-zinc-950">{{ t('moderation.queueTitle') }}</h2>
      <p v-if="!queueItems.length" class="mt-3 text-sm text-zinc-500">{{ t('moderation.queueEmpty') }}</p>
      <ul v-else class="mt-4 space-y-3">
        <li v-for="item in queueItems" :key="item.slug" class="rounded-xl bg-zinc-50 p-3">
          <NuxtLink :to="pagePath(item)" class="font-semibold text-emerald-900 underline">{{ item.title }}</NuxtLink>
          <p class="mt-1 text-xs text-zinc-500">{{ item.author }}</p>
        </li>
      </ul>
    </section>

    <AdminIntegrations v-if="settings" />

    <section v-if="settings && mesh" data-testid="mesh-panel" class="mt-8 min-w-0 rounded-2xl border border-zinc-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-zinc-950">{{ t('mesh.title') }}</h2>
      <p class="mt-2 text-sm leading-6 text-zinc-500">{{ t('mesh.intro') }}</p>
      <p class="mt-4 text-sm font-semibold text-zinc-800" data-testid="mesh-role">{{ mesh.role === 'hub' ? t('mesh.roleHub') : t('mesh.rolePeer', { hub: mesh.hub.url }) }}</p>
       <p class="mt-1 text-sm text-zinc-700" data-testid="mesh-total">{{ t('mesh.total', { count: formatCount(mesh.total) }) }}</p>
      <NodeMeshMap class="mt-4" :nodes="mesh.nodes" :links="mesh.links" :label="t('mesh.mapLabel')" />
      <p v-if="directoryLinks" class="mt-2 text-sm leading-6 text-zinc-500" data-testid="mesh-directory">{{ t('mesh.directory') }}</p>
      <ul class="mt-4 space-y-2">
        <li v-for="node in mesh.nodes" :key="node.url" class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-sm">
          <span class="min-w-0">
            <span class="font-semibold text-zinc-900">{{ node.name }}</span>
            <span class="mt-0.5 block break-all font-mono text-xs text-zinc-500">{{ node.url }}</span>
            <span class="text-xs text-zinc-500">{{ nodeRelation(node) }}</span>
          </span>
          <button v-if="!node.self && node.role !== 'hub'" type="button" class="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-white" data-testid="mesh-remove" @click="meshPost({ action: 'remove', url: node.url })">{{ t('mesh.remove') }}</button>
        </li>
      </ul>
      <form class="mt-5 space-y-3" @submit.prevent="meshPost({ action: 'hub', hubUrl: meshHub })">
        <label class="block text-sm font-medium text-zinc-800" for="mesh-hub-url">{{ t('mesh.hubLabel') }}
          <input id="mesh-hub-url" v-model="meshHub" data-testid="mesh-hub-url" class="mt-1.5 w-full min-w-0 rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100">
        </label>
        <p class="text-sm leading-6 text-zinc-500">{{ t('mesh.hubHint') }}</p>
        <button type="submit" class="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50" :disabled="meshSaving">{{ t('mesh.hubSave') }}</button>
      </form>
      <form v-if="mesh.role === 'hub'" class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" @submit.prevent="meshPost({ action: 'add', url: peerUrl })">
        <label class="block min-w-0 flex-1 text-sm font-medium text-zinc-800" for="mesh-peer-url">{{ t('mesh.peerLabel') }}
          <input id="mesh-peer-url" v-model="peerUrl" data-testid="mesh-peer-url" class="mt-1.5 w-full min-w-0 rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" placeholder="https://">
        </label>
        <button type="submit" data-testid="mesh-add" class="aiki-button rounded-xl px-4 py-2.5 text-sm font-semibold" :disabled="meshSaving">{{ t('mesh.add') }}</button>
      </form>
      <button type="button" data-testid="mesh-sync" class="mt-4 text-sm font-semibold text-emerald-900 underline" :disabled="meshSaving" @click="meshPost({ action: 'sync' })">{{ t('mesh.sync') }}</button>
      <p v-if="meshMessage" role="status" data-testid="mesh-saved" class="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{{ meshMessage }}</p>
      <p v-if="meshActionError" role="alert" class="mt-3 text-sm text-amber-800">{{ meshActionError }}</p>
    </section>
  </section>
</template>

<script setup>
import { DEFAULT_ACCENT_DARK, DEFAULT_ACCENT_LIGHT, accentInk, normalizeAccent } from '~/utils/accent.js'
import { formatCount } from '~/utils/number-format.js'
import { bugReportUrl, featureProposalUrl } from '~/utils/source.js'

const { t, locale } = useLocale()
const { data, error, pending, refresh } = await useFetch('/api/admin/settings')
const { data: meshData, refresh: refreshMesh } = await useFetch('/api/admin/mesh')
const { data: releaseData } = await useFetch('/api/admin/release')
const analyticsDays = ref('7')
const analyticsExpanded = ref(false)
const { data: analyticsData, error: analyticsFetchError, pending: analyticsPending, refresh: refreshAnalytics } = await useFetch('/api/admin/analytics', {
  query: computed(() => ({ days: analyticsDays.value })),
})
const release = computed(() => releaseData.value || null)
const settings = computed(() => data.value?.settings || null)
const analytics = computed(() => analyticsData.value?.analytics || null)
const analyticsCards = computed(() => [
  { key: 'unique', label: t('admin.analyticsUniqueVisitors'), value: analytics.value?.summary?.uniqueVisitors || 0 },
  { key: 'views', label: t('admin.analyticsPageViews'), value: analytics.value?.summary?.pageViews || 0 },
  { key: 'human', label: t('admin.analyticsHumanVisitors'), value: analytics.value?.summary?.humanVisitors || 0 },
  { key: 'bot', label: t('admin.analyticsBotVisitors'), value: analytics.value?.summary?.botVisitors || 0 },
])
const analyticsGroups = computed(() => [
  { key: 'country', title: t('admin.analyticsCountries'), items: analytics.value?.groups?.country || [] },
  { key: 'device', title: t('admin.analyticsDevices'), items: analytics.value?.groups?.device || [] },
  { key: 'browser', title: t('admin.analyticsBrowsers'), items: analytics.value?.groups?.browser || [] },
  { key: 'bot', title: t('admin.analyticsBots'), items: analytics.value?.groups?.bot || [] },
])
const mesh = computed(() => meshData.value?.mesh || null)
const directoryLinks = computed(() => (mesh.value?.links || []).some(link => link.via === 'directory'))
const meshHub = ref('https://aiki.wiki')
const peerUrl = ref('')
const meshSaving = ref(false)
const meshMessage = ref('')
const meshActionError = ref('')
const statusCode = computed(() => error.value?.statusCode || error.value?.status || null)
const countsPublic = ref(false)
const registrationOpen = ref(true)
const federationEnabled = ref(false)
const federationMode = ref('paused')
const displayName = ref('AiKi')
const accentLight = ref(DEFAULT_ACCENT_LIGHT)
const accentDark = ref(DEFAULT_ACCENT_DARK)
const accentError = ref(false)
const clearIcon = ref(false)
const iconData = ref('')
const localPreview = ref('')
const iconInput = ref(null)
const iconError = ref('')
const clearFavicon = ref(false)
const faviconData = ref('')
const faviconPreview = ref('')
const faviconInput = ref(null)
const faviconError = ref('')
const { data: ruleCatalog } = await useFetch('/api/article-rules', { query: computed(() => ({ locale: locale.value })) })
const baselineRules = computed(() => ruleCatalog.value?.baseline || [])
const ruleChoices = reactive({})
const replacements = reactive({})
const extraRules = ref([])
const moderationMode = ref('community')
const modelEnabled = ref(false)
const modelProvider = ref('openrouter')
const modelEndpoint = ref('')
const modelName = ref('')
const modelKey = ref('')
const modelOnFail = ref('unlisted')
const modelKeySet = ref(false)
const agentProviderMode = ref('disabled')
const agentProviderEndpoint = ref('')
const agentProviderKey = ref('')
const agentProviderKeySet = ref(false)
const agentProviderModel = ref('')
const agentProviderFastModel = ref('')
const agentProviderFormat = ref('task_json')
const agentBilling = ref(null)
const agentBillingLoading = ref(false)
const accessBlockThreat = ref(false)
const accessBlockDatacenter = ref(false)
const accessBlockScanner = ref(false)
const accessBlocks = ref([])
const accessIp = ref('')
const accessReason = ref('')
const accessActionPending = ref(false)
const accessActionError = ref('')
const { data: queueData, refresh: refreshQueue } = await useFetch('/api/moderation/queue')
const queueItems = computed(() => queueData.value?.items || [])
const saving = ref(false)
const saved = ref(false)
const saveError = ref(false)
const previewName = computed(() => displayName.value.replace(/\s+/g, ' ').trim() || 'AiKi')
const previewSrc = computed(() => {
  if (clearIcon.value) return '/aiki-galaxy.webp'
  return localPreview.value || settings.value?.iconUrl || '/aiki-galaxy.webp'
})
const faviconPreviewSrc = computed(() => {
  if (clearFavicon.value) return '/icon-192.png'
  return faviconPreview.value || settings.value?.faviconUrl || '/icon-192.png'
})

const autoSaveState = reactive({ access: '', federation: '' })
const autoSaveError = reactive({ access: '', federation: '' })

function autoSaveText(section) {
  const state = autoSaveState[section]
  if (state === 'saving') return t('admin.saving')
  if (state === 'saved') return t('admin.autoSaved')
  if (state === 'error') return autoSaveError[section] || t('admin.saveFailed')
  return t('admin.autoSaveHint')
}

function toggleFederation() {
  federationEnabled.value = !federationEnabled.value
  if (federationEnabled.value && federationMode.value === 'paused') federationMode.value = 'open'
  autoSave('federation')
}

// Toggles apply at once: the whole form is sent, so other edited fields are saved with them.
async function autoSave(section) {
  autoSaveState[section] = 'saving'
  autoSaveError[section] = ''
  const result = await save()
  if (result.ok) {
    autoSaveState[section] = 'saved'
    return
  }
  autoSaveState[section] = 'error'
  autoSaveError[section] = result.message
  if (section === 'federation') {
    federationEnabled.value = settings.value?.federation?.enabled === true
    federationMode.value = settings.value?.federation?.mode || 'paused'
  } else {
    accessBlockThreat.value = settings.value?.accessControl?.threat === true
    accessBlockDatacenter.value = settings.value?.accessControl?.datacenter === true
    accessBlockScanner.value = settings.value?.accessControl?.scanner === true
  }
}

watch(meshData, (value) => {
  if (value?.hubUrl) meshHub.value = value.hubUrl
}, { immediate: true })

function nodeRelation(node) {
  if (node.self) return t('mesh.self')
  if (node.role === 'hub') return t('mesh.center')
  return t('mesh.viaHub')
}

async function meshPost(body) {
  meshSaving.value = true
  meshMessage.value = ''
  meshActionError.value = ''
  try {
    meshData.value = await $fetch('/api/admin/mesh', { method: 'POST', body })
    meshMessage.value = t('mesh.saved')
    if (body.action === 'add') peerUrl.value = ''
    await refreshMesh()
  } catch (requestError) {
    const status = requestError?.statusCode || requestError?.status || requestError?.data?.statusCode
    meshActionError.value = status === 400 ? t('mesh.invalid') : t('mesh.failed')
  } finally {
    meshSaving.value = false
  }
}

watch([baselineRules, settings], () => {
  const saved = Array.isArray(settings.value?.articleRules) ? settings.value.articleRules : []
  extraRules.value = []
  for (const rule of baselineRules.value) {
    ruleChoices[rule.id] = 'keep'
    replacements[rule.id] = { statement: '', match: '' }
  }
  for (const item of saved) {
    if (item.effect === 'allow' || item.effect === 'replace') {
      ruleChoices[item.id] = item.effect
      replacements[item.id] = { statement: item.statement || '', match: item.match || '' }
    } else if (item.effect === 'add' || item.effect === 'forbid') {
      extraRules.value.push({ effect: item.effect, statement: item.statement || '', match: item.match || '' })
    }
  }
}, { immediate: true })

watch(settings, (value) => {
  if (!value) return
  moderationMode.value = value.moderationMode === 'manual' ? 'manual' : 'community'
  modelEnabled.value = value.assistant?.enabled === true
  modelProvider.value = ['openrouter', 'openai', 'neron'].includes(value.assistant?.provider) ? value.assistant.provider : 'openrouter'
  modelEndpoint.value = value.assistant?.baseUrl || ''
  modelName.value = value.assistant?.model || ''
  modelOnFail.value = value.assistant?.onFail === 'hidden' ? 'hidden' : 'unlisted'
  modelKeySet.value = value.assistant?.keySet === true
  modelKey.value = ''
  agentProviderMode.value = ['disabled', 'neron', 'aiki_cloud', 'custom'].includes(value.agentProvider?.mode) ? value.agentProvider.mode : 'disabled'
  agentProviderEndpoint.value = value.agentProvider?.endpoint || ''
  agentProviderKeySet.value = value.agentProvider?.keySet === true
  agentProviderKey.value = ''
  agentProviderModel.value = value.agentProvider?.model || ''
  agentProviderFastModel.value = value.agentProvider?.fastModel || ''
  agentProviderFormat.value = ['task_json', 'openai_chat', 'openai_responses'].includes(value.agentProvider?.format) ? value.agentProvider.format : 'task_json'
  accessBlockThreat.value = value.accessControl?.threat === true
  accessBlockDatacenter.value = value.accessControl?.datacenter === true
  accessBlockScanner.value = value.accessControl?.scanner === true
  accessBlocks.value = Array.isArray(value.accessControl?.customBlocks) ? value.accessControl.customBlocks : []
  accessActionError.value = ''
  countsPublic.value = value.countsPublic === true
  registrationOpen.value = value.registrationOpen !== false
  federationEnabled.value = value.federation?.enabled === true
  federationMode.value = ['open', 'inbound_only', 'outbound_only', 'paused'].includes(value.federation?.mode) ? value.federation.mode : 'paused'
  displayName.value = value.displayName || 'AiKi'
  accentLight.value = normalizeAccent(value.accentLight) || DEFAULT_ACCENT_LIGHT
  accentDark.value = normalizeAccent(value.accentDark) || DEFAULT_ACCENT_DARK
  accentError.value = false
  clearIcon.value = false
  iconData.value = ''
  localPreview.value = ''
  iconError.value = ''
  clearFavicon.value = false
  faviconData.value = ''
  faviconPreview.value = ''
  faviconError.value = ''
}, { immediate: true })

const agentBillingStatusText = computed(() => {
  if (!agentBilling.value) return ''
  if (agentBilling.value.status === 'not_configured') return t('admin.agentProviderBalanceNotConfigured')
  if (agentBilling.value.status === 'unsupported') return t('admin.agentProviderBalanceUnsupported')
  if (agentBilling.value.status === 'unavailable') return t('admin.agentProviderBalanceUnavailable')
  return ''
})

watch([settings, agentProviderMode], ([currentSettings, mode]) => {
  const savedMode = currentSettings?.agentProvider?.mode || 'disabled'
  if (!['aiki_cloud', 'neron'].includes(mode) || mode !== savedMode) {
    agentBilling.value = null
    return
  }
  refreshAgentBilling()
}, { immediate: true })

async function refreshAgentBilling() {
  if (!['aiki_cloud', 'neron'].includes(agentProviderMode.value)) return
  agentBillingLoading.value = true
  try {
    const result = await $fetch('/api/admin/agent-provider/billing')
    agentBilling.value = result?.billing || null
  } catch {
    agentBilling.value = { mode: agentProviderMode.value, ticker: agentProviderMode.value === 'aiki_cloud' ? 'WPG' : 'NAI', balance: null, status: 'unavailable' }
  } finally {
    agentBillingLoading.value = false
  }
}

function formatAnalyticsTime(value) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat(locale.value || 'en', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return String(value)
  }
}

function openAgentTopUp() {
  const url = agentBilling.value?.topUpUrl
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

function headerFileType(file) {
  if (['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) return file.type
  if (/\.svg$/i.test(file.name)) return 'image/svg+xml'
  return ''
}

function chooseIcon(event) {
  const file = event.target.files?.[0]
  iconError.value = ''
  if (!file) return
  if (!headerFileType(file) || file.size > 512_000) {
    iconError.value = file.size > 512_000 ? t('admin.iconTooLarge') : t('admin.iconType')
    event.target.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    iconData.value = String(reader.result || '')
    localPreview.value = iconData.value
    clearIcon.value = false
  }
  reader.readAsDataURL(file)
}

function setAccent(which, value) {
  const hex = normalizeAccent(value)
  if (!hex) {
    accentError.value = true
    return
  }
  accentError.value = false
  if (which === 'light') accentLight.value = hex
  else accentDark.value = hex
}

function previewStyle(hex) {
  const color = normalizeAccent(hex) || DEFAULT_ACCENT_LIGHT
  return { backgroundColor: color, color: accentInk(color) }
}

function resetAccents() {
  accentLight.value = DEFAULT_ACCENT_LIGHT
  accentDark.value = DEFAULT_ACCENT_DARK
  accentError.value = false
}

function collectArticleRules() {
  const list = []
  for (const rule of baselineRules.value) {
    const effect = ruleChoices[rule.id] || 'keep'
    if (effect === 'allow') list.push({ id: rule.id, effect })
    if (effect === 'replace') {
      const statement = replacements[rule.id]?.statement || ''
      const match = replacements[rule.id]?.match || ''
      list.push({ id: rule.id, effect, statement, ...(match ? { match } : {}) })
    }
  }
  extraRules.value.forEach((extra, index) => {
    const match = extra.match || ''
    list.push({ id: `node-${index + 1}`, effect: extra.effect, statement: extra.statement, ...(match ? { match } : {}) })
  })
  return list
}

function accessStaticaLabels(block) {
  const security = block?.statica?.security || {}
  const labels = []
  if (security.is_threat || security.is_attacker || security.is_abuser) labels.push(t('admin.accessControlThreat'))
  if (security.is_cloud_provider && !security.is_vpn) labels.push(t('admin.accessControlDatacenter'))
  if (security.is_clean) labels.push(t('admin.accessControlClean'))
  return labels
}

async function addAccessBlock() {
  accessActionPending.value = true
  accessActionError.value = ''
  try {
    const result = await $fetch('/api/admin/access-blocks', { method: 'POST', body: { ip: accessIp.value, reason: accessReason.value } })
    accessBlocks.value = result.blocks || []
    accessIp.value = ''
    accessReason.value = ''
  } catch (error) {
    accessActionError.value = error?.data?.statusMessage || t('admin.accessControlActionFailed')
  } finally {
    accessActionPending.value = false
  }
}

async function removeAccessBlock(id) {
  accessActionPending.value = true
  accessActionError.value = ''
  try {
    const result = await $fetch(`/api/admin/access-blocks/${encodeURIComponent(id)}`, { method: 'DELETE' })
    accessBlocks.value = result.blocks || []
  } catch (error) {
    accessActionError.value = error?.data?.statusMessage || t('admin.accessControlActionFailed')
  } finally {
    accessActionPending.value = false
  }
}

function restoreIcon() {
  clearIcon.value = true
  iconData.value = ''
  localPreview.value = ''
  if (iconInput.value) iconInput.value.value = ''
}

function chooseFavicon(event) {
  const file = event.target.files?.[0]
  faviconError.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 512_000) {
    faviconError.value = file.size > 512_000 ? t('admin.iconTooLarge') : t('admin.faviconType')
    event.target.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    faviconData.value = String(reader.result || '')
    faviconPreview.value = faviconData.value
    clearFavicon.value = false
  }
  reader.readAsDataURL(file)
}

function restoreFavicon() {
  clearFavicon.value = true
  faviconData.value = ''
  faviconPreview.value = ''
  if (faviconInput.value) faviconInput.value.value = ''
}

async function save() {
  saving.value = true
  saved.value = false
  saveError.value = false
  const light = normalizeAccent(accentLight.value)
  const dark = normalizeAccent(accentDark.value)
  if (iconError.value || faviconError.value || !light || !dark) {
    saving.value = false
    saveError.value = true
    accentError.value = !light || !dark
    return { ok: false, message: '' }
  }
  try {
    const result = await $fetch('/api/admin/settings', {
      method: 'PATCH',
      body: {
        countsPublic: countsPublic.value === true,
        registrationOpen: registrationOpen.value === true,
        federation: {
          enabled: federationEnabled.value === true,
          mode: federationEnabled.value ? federationMode.value : 'paused',
        },
        displayName: displayName.value,
        accentLight: light,
        accentDark: dark,
        ...(clearIcon.value ? { clearIcon: true } : {}),
        ...(iconData.value ? { icon: iconData.value } : {}),
        ...(clearFavicon.value ? { clearFavicon: true } : {}),
        ...(faviconData.value ? { favicon: faviconData.value } : {}),
        articleRules: collectArticleRules(),
        moderationMode: moderationMode.value === 'manual' ? 'manual' : 'community',
        accessControl: {
          threat: accessBlockThreat.value === true,
          datacenter: accessBlockDatacenter.value === true,
          scanner: accessBlockScanner.value === true,
        },
        assistant: {
          enabled: modelEnabled.value === true,
          provider: modelProvider.value,
          ...(modelProvider.value === 'neron' ? { baseUrl: modelEndpoint.value } : {}),
          model: modelName.value,
          apiKey: modelKey.value,
          onFail: modelOnFail.value,
          trigger: 'publish',
        },
        agentProvider: {
          mode: agentProviderMode.value,
          ...(agentProviderMode.value === 'neron' || agentProviderMode.value === 'custom' ? { endpoint: agentProviderEndpoint.value, apiKey: agentProviderKey.value } : {}),
          ...(agentProviderMode.value !== 'disabled' ? { model: agentProviderModel.value, fastModel: agentProviderFastModel.value } : {}),
          ...(agentProviderMode.value === 'custom' ? { model: agentProviderModel.value, format: agentProviderFormat.value } : {}),
        },
      },
    })
    data.value = result
    saved.value = true
    await refresh()
    await refreshNuxtData('node-public')
    await refreshQueue()
    return { ok: true }
  } catch (requestError) {
    saveError.value = true
    return { ok: false, message: requestError?.data?.statusMessage || requestError?.statusMessage || '' }
  } finally {
    saving.value = false
  }
}

useSeoMeta({ title: () => `${t('admin.title')} · AIKI`, robots: 'noindex, nofollow' })
</script>
