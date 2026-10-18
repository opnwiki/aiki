<template>
  <article data-testid="terms-page" class="mx-auto max-w-3xl">
    <p class="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">{{ t('terms.eyebrow') }}</p>
    <h1 class="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">{{ t('terms.title') }}</h1>
    <p class="mt-4 text-lg leading-8 text-zinc-700">{{ t('terms.intro', { domain }) }}</p>

    <nav class="mt-8 rounded-2xl border border-zinc-200 bg-white p-5" :aria-label="t('terms.contents')">
      <h2 class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{{ t('terms.contents') }}</h2>
      <ol class="mt-3 space-y-1.5 text-sm">
        <li v-for="section in sections" :key="section.id">
          <a :href="`#${section.id}`" class="text-emerald-900 underline decoration-emerald-200 underline-offset-4 hover:decoration-emerald-800">{{ section.title }}</a>
        </li>
        <li><a href="#article-rules" class="text-emerald-900 underline decoration-emerald-200 underline-offset-4 hover:decoration-emerald-800">{{ t('rules.termsTitle') }}</a></li>
      </ol>
    </nav>

    <section v-for="section in sections" :id="section.id" :key="section.id" class="mt-10 scroll-mt-24">
      <h2 class="text-xl font-semibold text-zinc-950">{{ section.title }}</h2>
      <p v-for="(paragraph, index) in section.paragraphs" :key="index" class="mt-3 leading-7 text-zinc-700">{{ fill(paragraph) }}</p>
    </section>

    <section id="article-rules" data-testid="terms-article-rules" class="mt-10 scroll-mt-24">
      <h2 class="text-xl font-semibold text-zinc-950">{{ t('rules.termsTitle') }}</h2>
      <ul class="mt-3 list-disc space-y-2 pl-5 leading-7 text-zinc-700">
        <li v-for="rule in articleRules" :key="rule.id">{{ rule.statement }}</li>
      </ul>
    </section>

    <p class="mt-10 text-sm leading-6 text-zinc-500">
      <NuxtLink to="/node" class="font-medium text-emerald-900 underline decoration-emerald-200 underline-offset-4">{{ t('terms.nodeLink') }}</NuxtLink>
    </p>
  </article>
</template>

<script setup>
import { termsSections } from '~/content/terms.js'

const { t, locale } = useLocale()
const { public: { nodeDomain } } = useRuntimeConfig()
const domain = computed(() => nodeDomain || 'aiki.wiki')
const sections = computed(() => termsSections(locale.value))
const { data: rulePayload } = await useFetch('/api/article-rules', { query: computed(() => ({ locale: locale.value })) })
const articleRules = computed(() => rulePayload.value?.rules || [])

function fill(paragraph) {
  return String(paragraph).replaceAll('{domain}', domain.value)
}

useSeoMeta({
  title: () => `${t('terms.title')} · AIKI`,
  description: () => t('terms.intro', { domain: domain.value }),
})
</script>
