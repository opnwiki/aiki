<template>
  <section class="mx-auto max-w-3xl space-y-6">
    <BackLink to="/">{{ t('account.home') }}</BackLink>
    <div>
      <p class="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">{{ t('auth.accounts') }}</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">{{ t('account.title') }}</h1>
      <p class="mt-3 leading-7 text-zinc-600">{{ t('account.description') }}</p>
      <p v-if="canReviewReports" class="mt-4">
        <NuxtLink to="/reports" class="text-sm font-medium text-emerald-800 hover:underline">{{ t('account.reports') }}</NuxtLink>
      </p>
    </div>

    <p v-if="pending" role="status" class="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">{{ t('topics.loading') }}</p>
    <div v-else-if="error || !account" role="alert" class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">{{ t('account.tokenNotAvailable') }}</div>
    <template v-else>
      <section class="grid gap-4 sm:grid-cols-2" aria-label="Account details">
        <article class="rounded-2xl border border-zinc-200 bg-white p-5">
          <div class="flex items-start justify-between gap-3">
            <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('account.username') }}</p>
            <button v-if="!usernameEditing" type="button" data-testid="account-username-edit" class="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50" @click="startUsernameEdit">{{ t('account.usernameChange') }}</button>
          </div>
          <p v-if="!usernameEditing" class="mt-2 break-all text-lg font-semibold text-zinc-900" data-testid="account-username">{{ account.username }}</p>
          <form v-else class="mt-2 grid gap-2" data-testid="account-username-form" @submit.prevent="saveUsername">
            <input v-model="usernameDraft" data-testid="account-username-input" type="text" maxlength="32" autocomplete="username" spellcheck="false" class="w-full min-w-0 rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" @input="checkUsernameSoon">
            <p v-if="usernameStatus" class="text-xs leading-5" :class="usernameStatus.ok ? 'text-emerald-700' : 'text-amber-800'" role="status">{{ usernameStatus.text }}</p>
            <p v-if="account.federationEnabled" class="text-xs leading-5 text-zinc-500">{{ t('account.usernameFediverseHint', { host: requestHost }) }}</p>
            <p class="text-xs leading-5 text-zinc-500">{{ t('account.usernameHint') }}</p>
            <div class="flex flex-wrap gap-2">
              <button type="submit" data-testid="account-username-save" class="aiki-button rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-60" :disabled="usernamePending || usernameDraft.trim() === account.username || usernameStatus?.ok === false">{{ usernamePending ? t('account.profileSaving') : t('account.usernameSave') }}</button>
              <button type="button" class="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50" @click="usernameEditing = false">{{ t('topic.cancelEdit') }}</button>
            </div>
          </form>
          <p v-if="account.email" class="mt-1 break-all text-sm text-zinc-500">{{ account.email }}</p>
        </article>
        <article class="rounded-2xl border border-zinc-200 bg-white p-5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('account.userId') }}</p>
              <code data-testid="account-user-id" class="mt-2 block font-mono text-xl font-semibold text-zinc-900">#{{ account.publicId }}</code>
              <p class="mt-1 text-xs leading-5 text-zinc-500">{{ t('account.userIdScope') }}</p>
            </div>
            <button type="button" class="shrink-0 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" @click="copyId">{{ copied ? t('account.copied') : t('account.copyId') }}</button>
          </div>
          <p v-if="copyError" role="alert" class="mt-2 text-xs text-amber-800">{{ t('account.copyFailed') }}</p>
        </article>
      </section>

      <section id="account-profile" data-testid="account-profile" class="rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="account-profile-title">
        <h2 id="account-profile-title" class="text-lg font-semibold text-zinc-950">{{ t('account.profileTitle') }}</h2>
        <p class="mt-2 text-sm leading-6 text-zinc-600">{{ t('account.profileHint') }}</p>
        <div class="mt-5 flex flex-wrap items-center gap-4 rounded-xl bg-zinc-50 p-4">
          <img v-if="account.avatarUrl" :src="`${account.avatarUrl}?v=${avatarVersion}`" alt="" width="72" height="72" class="size-18 shrink-0 rounded-full border border-zinc-200 object-cover" loading="lazy">
          <div v-else class="flex size-18 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-2xl font-semibold text-zinc-500" aria-hidden="true">{{ (account.displayName || account.username || '?').slice(0, 1).toUpperCase() }}</div>
          <div class="grid min-w-0 flex-1 gap-2">
            <p class="truncate text-sm font-semibold text-zinc-900">{{ account.displayName || account.username }}</p>
            <p class="text-xs text-zinc-500" data-testid="account-avatar-current">{{ t('account.avatarShown', { source: avatarSourceLabel(account.avatarPreference) }) }}<span v-if="!account.avatarUrl"> · {{ t('account.avatarNotReady') }}</span></p>
            <div class="flex flex-wrap items-center gap-2">
              <label class="cursor-pointer rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 focus-within:ring-2 focus-within:ring-emerald-600">
                {{ t('account.avatarChoose') }}
                <input data-testid="account-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" @change="chooseAvatar">
              </label>
              <button v-if="avatarFile" type="button" data-testid="account-avatar-upload" class="aiki-button rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-60" :disabled="avatarUploadPending" @click="uploadAvatar">{{ avatarUploadPending ? t('account.avatarUploading') : t('account.avatarUpload') }}</button>
              <button v-if="account.hasCustomAvatar" type="button" data-testid="account-avatar-delete" class="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60" :disabled="avatarUploadPending" @click="deleteAvatar">{{ t('account.avatarDelete') }}</button>
            </div>
            <p v-if="avatarFile" class="truncate text-xs text-zinc-500">{{ avatarFile.name }}</p>
          </div>
        </div>
        <form class="mt-5 grid gap-5 sm:grid-cols-2" @submit.prevent="saveProfile">
          <label class="grid min-w-0 gap-1 text-sm font-medium text-zinc-700 sm:col-span-2">
            {{ t('account.displayName') }}
            <input v-model="displayNameDraft" data-testid="account-display-name" type="text" maxlength="80" autocomplete="nickname" class="w-full min-w-0 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 font-normal text-zinc-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" :placeholder="t('account.displayNamePlaceholder')">
          </label>
          <fieldset data-testid="account-avatar-preference" class="grid min-w-0 gap-2 sm:col-span-2">
            <legend class="text-sm font-medium text-zinc-700">{{ t('account.avatarPreference') }}</legend>
            <div class="grid grid-cols-3 gap-2 sm:gap-3">
              <label v-for="option in avatarOptions" :key="option.value" :data-testid="`account-avatar-option-${option.value}`" class="relative flex min-w-0 cursor-pointer flex-col items-center gap-2 rounded-xl border p-3 text-center text-xs font-medium transition focus-within:ring-2 focus-within:ring-emerald-600" :class="avatarPreferenceDraft === option.value ? 'border-emerald-700 bg-emerald-50 text-emerald-950' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'">
                <input v-model="avatarPreferenceDraft" type="radio" name="avatar-preference" :value="option.value" class="sr-only">
                <img v-if="option.src" :src="option.src" alt="" width="56" height="56" class="size-14 rounded-full border border-zinc-200 object-cover" loading="lazy">
                <span v-else class="flex size-14 items-center justify-center rounded-full border border-dashed border-zinc-300 text-[10px] leading-3 text-zinc-500">{{ option.missing }}</span>
                <span class="min-w-0 break-words">{{ option.label }}</span>
                <span v-if="account.avatarPreference === option.value" class="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{{ t('account.avatarCurrent') }}</span>
              </label>
            </div>
            <p class="text-xs leading-5 text-zinc-500">{{ t('account.avatarPreferenceHint') }}</p>
          </fieldset>
          <div class="grid min-w-0 content-start gap-1 sm:col-span-2">
            <label for="account-author-visibility" class="text-sm font-medium text-zinc-700">{{ t('account.authorVisibility') }}</label>
            <select id="account-author-visibility" v-model="showAuthorDraft" data-testid="account-author-visibility" class="w-full min-w-0 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 font-normal text-zinc-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100">
              <option :value="true">{{ t('account.authorVisibilityShow') }}</option>
              <option :value="false">{{ t('account.authorVisibilityHide') }}</option>
            </select>
            <p class="text-xs leading-5 text-zinc-500">{{ t('account.authorVisibilityHint') }}</p>
          </div>
          <div class="flex min-w-0 items-start gap-3 rounded-xl border border-zinc-200 p-4 sm:col-span-2">
            <button
              type="button"
              role="switch"
              data-testid="account-federation-enabled"
              :aria-checked="federationEnabledDraft"
              aria-labelledby="account-federation-label"
              class="mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              :class="federationEnabledDraft ? '' : 'bg-zinc-300'"
              :style="federationEnabledDraft ? { backgroundColor: 'var(--aiki-accent)' } : undefined"
              @click="federationEnabledDraft = !federationEnabledDraft"
            >
              <span class="size-5 rounded-full bg-white shadow transition" :class="federationEnabledDraft ? 'translate-x-5' : 'translate-x-0'"></span>
            </button>
            <div class="min-w-0">
              <p id="account-federation-label" class="text-sm font-semibold text-zinc-800">{{ t('account.federationEnabled') }}</p>
              <p v-if="federationEnabledDraft && fediverseAddress" class="mt-1 break-all font-mono text-sm text-zinc-700" data-testid="account-fediverse-address">{{ fediverseAddress }}</p>
              <p v-else-if="federationEnabledDraft && account.username" class="mt-1 text-xs leading-5 text-amber-800" data-testid="account-fediverse-incompatible">{{ t('account.federationUsernameIncompatible') }}</p>
              <p class="mt-1 text-xs leading-5 text-zinc-500">{{ t('account.federationHint') }}</p>
            </div>
          </div>
          <div class="sm:col-span-2">
            <button type="submit" data-testid="account-display-name-save" class="aiki-button w-full rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60 sm:w-auto" :disabled="profilePending">{{ profilePending ? t('account.profileSaving') : t('account.profileSave') }}</button>
          </div>
        </form>
        <p v-if="avatarSaved" data-testid="account-avatar-saved" role="status" class="mt-3 text-sm text-emerald-800">{{ t('account.avatarSaved') }}</p>
        <p v-if="avatarError" role="alert" class="mt-3 text-sm text-red-800">{{ avatarError }}</p>
        <p v-if="profileSaved" data-testid="account-profile-saved" role="status" class="mt-3 text-sm text-emerald-800">{{ t('account.profileSaved') }}</p>
        <p v-if="profileError" role="alert" class="mt-3 text-sm text-red-800">{{ profileError }}</p>
      </section>

      <section id="account-notifications" data-testid="account-notifications" class="rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="account-notifications-title">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <h2 id="account-notifications-title" class="text-lg font-semibold text-zinc-950">{{ t('notifications.title') }}</h2>
          <span v-if="unreadCount" data-testid="account-notifications-badge" class="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--aiki-accent)] px-2 text-sm font-semibold text-[var(--aiki-accent-ink)]">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
        </div>
        <p class="mt-2 text-sm leading-6 text-zinc-600">{{ t('notifications.description') }}</p>
        <NuxtLink to="/notifications" class="aiki-button mt-4 inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold">{{ t('notifications.openSection') }}</NuxtLink>
      </section>

      <section id="account-client" data-testid="account-client" class="rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="account-client-title">
        <h2 id="account-client-title" class="text-lg font-semibold text-zinc-950">{{ t('account.clientTitle') }}</h2>
        <p class="mt-2 text-sm leading-6 text-zinc-600">{{ t('account.clientHint') }}</p>
        <label class="mt-4 flex items-start gap-3 text-sm text-zinc-800">
          <input data-testid="account-client-toggle" type="checkbox" class="mt-1" :checked="showClient" :disabled="clientPending" @change="saveClient">
          <span>{{ t('account.clientShow') }}</span>
        </label>
        <p v-if="clientSaved" data-testid="account-client-saved" role="status" class="mt-3 text-sm text-emerald-800">{{ t('account.clientSaved') }}</p>
        <p v-if="clientError" role="alert" class="mt-3 text-sm text-red-800">{{ t('account.clientFailed') }}</p>
      </section>

      <section id="account-security" data-testid="account-security" class="rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="account-security-title">
        <h2 id="account-security-title" class="text-lg font-semibold text-zinc-950">{{ t('account.securityTitle') }}</h2>
        <p class="mt-2 text-sm leading-6 text-zinc-600">{{ account.hasPassword ? t('account.changePasswordHint') : t('account.setPasswordHint') }}</p>
        <div class="mt-4">
          <button type="button" data-testid="account-change-password-open" class="aiki-button rounded-xl px-4 py-2.5 text-sm font-semibold" @click="openPasswordModal">{{ t('account.changePassword') }}</button>
        </div>
        <p v-if="passwordSaved" data-testid="account-password-saved" role="status" class="mt-3 text-sm text-emerald-800">{{ t('account.passwordSaved') }}</p>
      </section>

      <AppModal
        :open="passwordModalOpen"
        :title="t('account.changePassword')"
        :close-label="t('topic.reportClose')"
        @close="closePasswordModal"
      >
        <form class="grid gap-3" @submit.prevent="changePassword">
          <label v-if="account.hasPassword" class="grid gap-1 text-sm font-medium text-zinc-700">
            {{ t('account.currentPassword') }}
            <input v-model="passwordCurrent" data-testid="account-current-password" type="password" autocomplete="current-password" class="rounded-xl border border-zinc-300 px-3 py-2.5 font-normal" required>
          </label>
          <label class="grid gap-1 text-sm font-medium text-zinc-700">
            {{ t('account.newPassword') }}
            <input v-model="passwordNew" data-testid="account-new-password" type="password" autocomplete="new-password" minlength="12" maxlength="256" class="rounded-xl border border-zinc-300 px-3 py-2.5 font-normal" required>
          </label>
          <label class="grid gap-1 text-sm font-medium text-zinc-700">
            {{ t('account.confirmPassword') }}
            <input v-model="passwordConfirm" data-testid="account-confirm-password" type="password" autocomplete="new-password" minlength="12" maxlength="256" class="rounded-xl border border-zinc-300 px-3 py-2.5 font-normal" required>
          </label>
          <p v-if="passwordError" role="alert" class="rounded-xl bg-red-50 p-3 text-sm text-red-800">{{ passwordError }}</p>
          <div class="flex justify-end">
            <button type="submit" data-testid="account-change-password" class="aiki-button rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60" :disabled="passwordPending">{{ passwordPending ? t('account.passwordSaving') : t('account.changePassword') }}</button>
          </div>
        </form>
      </AppModal>

      <section id="account-agent-access" data-testid="account-agent-access" class="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6" aria-labelledby="account-agent-access-title">
        <h2 id="account-agent-access-title" class="text-lg font-semibold text-emerald-950">{{ t('account.agentAccessTitle') }}</h2>
        <p class="mt-2 text-sm leading-6 text-emerald-900">{{ t('account.agentAccessHint') }}</p>
        <p v-if="account.linkedAgent" class="mt-3 text-sm text-emerald-950">{{ t('account.linkedAgent', { name: account.linkedAgent.name || account.linkedAgent.username }) }}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" data-testid="account-agent-key" class="aiki-button rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60" :disabled="agentKeyPending" @click="issueAgentKey">{{ account.linkedAgent ? t('account.rotateAgentKey') : t('account.createAgentKey') }}</button>
          <button v-if="agentKeySecret" type="button" class="rounded-xl border border-emerald-900 px-4 py-2.5 text-sm font-semibold text-emerald-950 hover:bg-white" @click="copyAgentKey">{{ agentKeyCopied ? t('account.agentKeyCopied') : t('account.copyAgentKey') }}</button>
        </div>
        <p v-if="agentKeySecret" data-testid="account-agent-key-value" class="mt-4 break-all rounded-xl border border-emerald-200 bg-white p-3 font-mono text-xs text-zinc-800">{{ agentKeySecret }}</p>
        <p v-if="agentKeySecret" class="mt-2 text-xs leading-5 text-emerald-900">{{ t('account.agentKeyOneTime') }}</p>
        <p v-if="agentKeyError" role="alert" class="mt-3 text-sm text-red-800">{{ agentKeyError }}</p>
      </section>

      <section id="transfers" data-testid="account-transfers" class="rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="transfers-title">
        <h2 id="transfers-title" class="text-lg font-semibold text-zinc-950">{{ t('account.transfersTitle') }}</h2>
        <p class="mt-2 text-sm leading-6 text-zinc-600">{{ t('account.transfersHint') }}</p>
        <p v-if="transferError" role="alert" class="mt-3 text-sm text-amber-800">{{ transferError }}</p>
        <p v-if="!incoming.length" class="mt-4 text-sm text-zinc-500">{{ t('account.transfersEmpty') }}</p>
        <ul v-else class="mt-4 divide-y divide-zinc-100">
          <li v-for="item in incoming" :key="item.id" class="py-4" data-testid="account-transfer-item">
            <p class="text-sm leading-6 text-zinc-800">{{ t('account.transfersItem', { name: item.offeredBy?.username || t('topic.activityCommunity'), title: item.title }) }}</p>
            <p v-if="item.note" class="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-600">{{ item.note }}</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" data-testid="account-transfer-accept" class="aiki-button rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60" :disabled="transferPending === item.id" @click="decideTransfer(item, 'accept')">{{ t('topic.transferAccept') }}</button>
              <button type="button" data-testid="account-transfer-decline" class="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60" :disabled="transferPending === item.id" @click="decideTransfer(item, 'decline')">{{ t('topic.transferDecline') }}</button>
              <NuxtLink :to="pagePath(item)" class="rounded-xl px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50">{{ t('account.transferOpen') }}</NuxtLink>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="canManage" data-testid="account-node-panel" class="rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="node-admin-title">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('account.nodeEyebrow') }}</p>
            <h2 id="node-admin-title" class="mt-1 text-lg font-semibold text-zinc-950">{{ t('account.nodeTitle') }}</h2>
          </div>
          <NuxtLink to="/admin" data-testid="account-open-admin" class="aiki-button inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold">{{ t('account.nodeOpenAdmin') }}</NuxtLink>
        </div>
        <p class="mt-3 text-sm text-zinc-600">{{ t('account.nodeDomain', { domain: nodeDomain }) }}</p>
        <p v-if="nodePending" role="status" class="mt-4 text-sm text-zinc-500">{{ t('topics.loading') }}</p>
        <p v-else-if="nodeError" role="alert" class="mt-4 text-sm text-amber-800">{{ t('account.nodeUnavailable') }}</p>
        <template v-else-if="nodeSettings">
          <dl data-testid="account-node-counts" class="mt-4 grid gap-3 sm:grid-cols-3">
            <div class="rounded-xl bg-zinc-50 p-4">
              <dt class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('node.pagesLabel') }}</dt>
              <dd class="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">{{ formatCount(nodeSettings.pages) }}</dd>
            </div>
            <div class="rounded-xl bg-zinc-50 p-4">
              <dt class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('node.humansLabel') }}</dt>
              <dd class="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">{{ formatCount(nodeSettings.users) }}</dd>
            </div>
            <div class="rounded-xl bg-zinc-50 p-4">
              <dt class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{{ t('node.agentsLabel') }}</dt>
              <dd class="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">{{ formatCount(nodeSettings.agents ?? 0) }}</dd>
            </div>
          </dl>
          <p class="mt-3 text-sm text-zinc-500">{{ nodeSettings.countsPublic ? t('account.nodeCountsPublic') : t('account.nodeCountsPrivate') }}</p>
        </template>
      </section>

      <section class="rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="archive-title">
        <h2 id="archive-title" class="text-lg font-semibold text-zinc-950">{{ t('account.archiveTitle') }}</h2>
        <p class="mt-3 text-sm leading-6 text-zinc-600">{{ t('account.archiveText') }}</p>
        <p class="mt-2 text-sm leading-6 text-zinc-500">{{ t('account.archiveRules') }}</p>
        <div class="mt-5 flex flex-wrap items-center gap-3">
          <a href="/api/account-archive" data-testid="account-export" class="aiki-button inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold">{{ t('account.export') }}</a>
        </div>
        <form class="mt-5 grid gap-3" @submit.prevent="importArchive">
          <label class="text-sm font-medium text-zinc-700">{{ t('account.importFile') }}
            <input data-testid="account-import-file" type="file" accept="application/json,.json" class="mt-1.5 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-zinc-800" @change="chooseArchive">
          </label>
          <div>
            <button type="submit" data-testid="account-import" class="inline-flex rounded-xl border border-emerald-900 px-4 py-2.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-60" :disabled="importing">{{ importing ? t('account.importWorking') : t('account.import') }}</button>
          </div>
          <p v-if="importError" role="alert" class="text-sm text-amber-800">{{ importError }}</p>
          <p v-if="importMessage" data-testid="account-import-message" role="status" class="text-sm text-emerald-900">{{ importMessage }}</p>
        </form>
      </section>

      <section class="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6" aria-labelledby="wpg-title">
        <p class="text-xs font-semibold uppercase tracking-wide text-emerald-900">{{ t('account.tokens') }}</p>
        <h2 id="wpg-title" data-testid="wpg-balance" class="mt-2 text-4xl font-semibold tracking-tight text-emerald-950">{{ formatCount(account.tokenAccount.balance) }} <span class="text-xl">WPG</span></h2>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-emerald-900">{{ t('account.tokenDescription') }}</p>
        <p class="mt-1 text-xs text-emerald-800">{{ t('account.redemptionDisabled') }}</p>
        <NuxtLink to="/" class="aiki-button mt-5 inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold">{{ t('account.orderArticle') }}</NuxtLink>
      </section>

      <section class="rounded-2xl border border-zinc-200 bg-white p-6" aria-labelledby="wpg-history-title">
        <h2 id="wpg-history-title" class="text-lg font-semibold text-zinc-900">{{ t('account.history') }}</h2>
        <p v-if="!account.tokenAccount.history.length" class="mt-4 text-sm text-zinc-500">{{ t('account.emptyHistory') }}</p>
        <ul v-else class="mt-4 divide-y divide-zinc-100">
          <li v-for="(entry, index) in account.tokenAccount.history" :key="`${entry.sourceId}-${entry.amount}-${index}`" class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <p class="text-sm font-medium text-zinc-800">{{ entry.description }}</p>
              <p class="mt-1 text-xs text-zinc-500">{{ formatDate(entry.createdAt) }}</p>
            </div>
            <span class="font-mono text-sm font-semibold" :class="entry.amount > 0 ? 'text-emerald-800' : 'text-zinc-700'">{{ entry.amount > 0 ? '+' : '' }}{{ formatCount(entry.amount) }} WPG</span>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<script setup>
import { formatCount } from '~/utils/number-format.js'

const { t, locale } = useLocale()
const { public: { nodeDomain } } = useRuntimeConfig()
const { data, pending, error, refresh } = await useFetch('/api/account')
const { data: transferData, refresh: refreshTransfers } = await useFetch('/api/account/transfers')
const account = computed(() => data.value?.account || null)
const canReviewReports = computed(() => ['owner', 'admin', 'moderator'].includes(account.value?.role))
const incoming = computed(() => transferData.value?.items || [])
const { data: unreadState } = useNuxtData('notifications-unread')
const unreadCount = computed(() => Number(unreadState.value?.unread || 0))
const transferError = ref('')
const transferPending = ref('')
const canManage = computed(() => ['owner', 'admin'].includes(account.value?.role))
const nodeSettings = ref(null)
const nodePending = ref(false)
const nodeError = ref(false)
if (canManage.value) {
  nodePending.value = true
  try {
    const result = await useRequestFetch()('/api/admin/settings')
    nodeSettings.value = result.settings
  } catch {
    nodeError.value = true
  } finally {
    nodePending.value = false
  }
}
const showClient = ref(true)
const clientPending = ref(false)
const clientSaved = ref(false)
const clientError = ref(false)
const agentKeyPending = ref(false)
const agentKeyError = ref('')
const agentKeySecret = ref('')
const agentKeyCopied = ref(false)
const passwordCurrent = ref('')
const passwordNew = ref('')
const passwordConfirm = ref('')
const passwordPending = ref(false)
const passwordSaved = ref(false)
const passwordError = ref('')
const passwordModalOpen = ref(false)
const displayNameDraft = ref('')
const profilePending = ref(false)
const profileSaved = ref(false)
const profileError = ref('')
const avatarPreferenceDraft = ref('statica')
const showAuthorDraft = ref(true)
const federationEnabledDraft = ref(true)
const requestHost = useRequestURL().host
// Only usernames that fit the ActivityPub handle rule get a public actor (see server/federation.js).
const fediverseAddress = computed(() => /^[a-z0-9][a-z0-9_-]{2,31}$/.test(account.value?.username || '') ? `@${account.value.username}@${requestHost}` : '')
const avatarFile = ref(null)
const avatarVersion = ref(Date.now())
const avatarBase = computed(() => account.value?.publicId ? `/api/actors/${account.value.publicId}/avatar` : '')
function avatarSourceLabel(value) {
  return value === 'custom' ? t('account.avatarCustom') : value === 'gravatar' ? t('account.avatarGravatar') : t('account.avatarStatica')
}
const avatarOptions = computed(() => {
  const preview = source => avatarBase.value ? `${avatarBase.value}?source=${source}&v=${avatarVersion.value}` : null
  return [
    { value: 'custom', label: t('account.avatarCustom'), src: account.value?.hasCustomAvatar ? preview('upload') : null, missing: t('account.avatarNone') },
    { value: 'statica', label: t('account.avatarStatica'), src: account.value?.hasStaticaAvatar ? preview('statica') : null, missing: t('account.avatarPending') },
    { value: 'gravatar', label: t('account.avatarGravatar'), src: account.value?.hasGravatarAvatar ? preview('gravatar') : null, missing: t('account.avatarNone') },
  ]
})
const avatarUploadPending = ref(false)
const avatarSaved = ref(false)
const avatarError = ref('')
watch(account, (value) => {
  if (value && typeof value.showClient === 'boolean') showClient.value = value.showClient
  if (value) {
    displayNameDraft.value = value.displayName || ''
    avatarPreferenceDraft.value = value.avatarPreference || 'statica'
    showAuthorDraft.value = value.showAuthor !== false
    federationEnabledDraft.value = value.federationEnabled === true
  }
}, { immediate: true })

async function saveProfile() {
  profilePending.value = true
  profileSaved.value = false
  profileError.value = ''
  try {
    const result = await $fetch('/api/account/profile', {
      method: 'PATCH',
      body: { displayName: displayNameDraft.value, avatarPreference: avatarPreferenceDraft.value, showAuthor: showAuthorDraft.value, federationEnabled: federationEnabledDraft.value === true },
    })
    displayNameDraft.value = result.displayName || ''
    avatarPreferenceDraft.value = result.avatarPreference || 'statica'
    showAuthorDraft.value = result.showAuthor !== false
    federationEnabledDraft.value = result.federationEnabled === true
    await refresh()
    avatarVersion.value = Date.now()
    profileSaved.value = true
  } catch (requestError) {
    profileError.value = requestError?.data?.statusMessage || t('account.profileFailed')
  } finally {
    profilePending.value = false
  }
}

function chooseAvatar(event) {
  avatarFile.value = event.target.files?.[0] || null
  avatarSaved.value = false
  avatarError.value = ''
}

async function uploadAvatar() {
  if (!avatarFile.value) return
  avatarUploadPending.value = true
  avatarSaved.value = false
  avatarError.value = ''
  try {
    const body = new FormData()
    body.append('avatar', avatarFile.value)
    await $fetch('/api/account/avatar', { method: 'POST', body })
    avatarFile.value = null
    avatarPreferenceDraft.value = 'custom'
    avatarVersion.value = Date.now()
    await refresh()
    avatarSaved.value = true
  } catch (requestError) {
    avatarError.value = requestError?.data?.statusMessage || t('account.avatarFailed')
  } finally {
    avatarUploadPending.value = false
  }
}

async function deleteAvatar() {
  avatarUploadPending.value = true
  avatarSaved.value = false
  avatarError.value = ''
  try {
    const result = await $fetch('/api/account/avatar', { method: 'DELETE' })
    avatarPreferenceDraft.value = result.avatarPreference || 'statica'
    avatarVersion.value = Date.now()
    await refresh()
    avatarSaved.value = true
  } catch (requestError) {
    avatarError.value = requestError?.data?.statusMessage || t('account.avatarFailed')
  } finally {
    avatarUploadPending.value = false
  }
}

async function saveClient(event) {
  const next = event.target.checked
  clientPending.value = true
  clientSaved.value = false
  clientError.value = false
  try {
    const result = await $fetch('/api/account/client', { method: 'PATCH', body: { showClient: next } })
    showClient.value = result.showClient === true
    clientSaved.value = true
  } catch {
    event.target.checked = showClient.value
    clientError.value = true
  } finally {
    clientPending.value = false
  }
}

function openPasswordModal() {
  passwordSaved.value = false
  passwordError.value = ''
  passwordModalOpen.value = true
}

function closePasswordModal() {
  if (!passwordPending.value) passwordModalOpen.value = false
}

async function changePassword() {
  passwordSaved.value = false
  passwordError.value = ''
  if (passwordNew.value !== passwordConfirm.value) {
    passwordError.value = t('account.passwordMismatch')
    return
  }
  passwordPending.value = true
  try {
    await $fetch('/api/account/password', {
      method: 'PATCH',
      body: {
        ...(account.value?.hasPassword ? { currentPassword: passwordCurrent.value } : {}),
        newPassword: passwordNew.value,
      },
    })
    passwordCurrent.value = ''
    passwordNew.value = ''
    passwordConfirm.value = ''
    passwordSaved.value = true
    passwordModalOpen.value = false
    await refresh()
  } catch (requestError) {
    passwordError.value = requestError?.data?.statusMessage || t('account.passwordFailed')
  } finally {
    passwordPending.value = false
  }
}

async function issueAgentKey() {
  agentKeyPending.value = true
  agentKeyError.value = ''
  agentKeySecret.value = ''
  agentKeyCopied.value = false
  try {
    const result = await $fetch('/api/account/agent-key', { method: 'POST', body: {} })
    agentKeySecret.value = result.api_key || ''
    await refresh()
  } catch (requestError) {
    agentKeyError.value = requestError?.data?.statusMessage || t('account.agentKeyFailed')
  } finally {
    agentKeyPending.value = false
  }
}

async function copyAgentKey() {
  try {
    await navigator.clipboard.writeText(agentKeySecret.value)
    agentKeyCopied.value = true
  } catch {
    agentKeyCopied.value = false
  }
}

const copied = ref(false)
const usernameEditing = ref(false)
const usernameDraft = ref('')
const usernamePending = ref(false)
const usernameStatus = ref(null)
let usernameTimer
function startUsernameEdit() {
  usernameDraft.value = account.value?.username || ''
  usernameStatus.value = null
  usernameEditing.value = true
}
function checkUsernameSoon() {
  clearTimeout(usernameTimer)
  usernameStatus.value = null
  const candidate = usernameDraft.value.trim()
  if (!candidate || candidate === account.value?.username) return
  usernameTimer = setTimeout(async () => {
    try {
      const result = await $fetch('/api/auth/username-availability', { query: { username: candidate } })
      if (usernameDraft.value.trim() !== candidate) return
      usernameStatus.value = result.available
        ? { ok: true, text: t('account.usernameAvailable') }
        : { ok: false, text: t(result.reason === 'invalid' ? 'account.usernameInvalid' : 'account.usernameTaken') }
    } catch {}
  }, 350)
}
async function saveUsername() {
  usernamePending.value = true
  try {
    await $fetch('/api/account/username', { method: 'PATCH', body: { username: usernameDraft.value.trim() } })
    usernameEditing.value = false
    usernameStatus.value = null
    await refresh()
  } catch (requestError) {
    usernameStatus.value = { ok: false, text: requestError?.data?.statusMessage || t('account.profileFailed') }
  } finally {
    usernamePending.value = false
  }
}
const copyError = ref(false)
const archiveFile = ref(null)
const importing = ref(false)
const importMessage = ref('')
const importError = ref('')
let copyTimer

function chooseArchive(event) {
  archiveFile.value = event.target.files?.[0] || null
  importMessage.value = ''
  importError.value = ''
}

async function importArchive() {
  importMessage.value = ''
  importError.value = ''
  if (!archiveFile.value) {
    importError.value = t('account.importEmpty')
    return
  }
  importing.value = true
  try {
    const body = new FormData()
    body.append('file', archiveFile.value)
    const result = await $fetch('/api/account-archive', { method: 'POST', body })
    importMessage.value = [
      t('account.importDone', { pages: result.imported?.pages || 0, comments: result.imported?.comments || 0 }),
      (result.alreadyPresent?.pages || result.alreadyPresent?.comments) ? t('account.importAlready', { pages: result.alreadyPresent?.pages || 0, comments: result.alreadyPresent?.comments || 0 }) : '',
      result.skippedComments ? t('account.importSkipped', { count: result.skippedComments }) : '',
      result.pagesWithoutBranch ? t('account.importUnbranched', { count: result.pagesWithoutBranch }) : '',
    ].filter(Boolean).join(' ')
  } catch (error) {
    importError.value = error?.data?.statusMessage || t('account.importFailed')
  } finally {
    importing.value = false
  }
}

async function decideTransfer(item, action) {
  transferPending.value = item.id
  transferError.value = ''
  try {
    await $fetch(`/api/topics/${encodeURIComponent(item.slug)}/transfer/${encodeURIComponent(item.id)}`, {
      method: 'POST',
      body: { action },
    })
    await refreshTransfers()
  } catch (requestError) {
    transferError.value = requestError?.data?.statusMessage || t('topic.transferFailed')
  } finally {
    transferPending.value = ''
  }
}

async function copyId() {
  copyError.value = false
  try {
    await navigator.clipboard.writeText(String(account.value.publicId))
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 2000)
  } catch {
    copyError.value = true
  }
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return String(value)
  }
}

onBeforeUnmount(() => clearTimeout(copyTimer))
useSeoMeta({ title: () => `${t('account.title')} · AIKI`, robots: 'noindex, nofollow' })
</script>
