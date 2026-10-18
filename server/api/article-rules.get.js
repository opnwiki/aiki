import { getQuery } from 'h3'
import { articleRuleBaseline, loadArticleRuleOverrides, presentArticleRules } from '../utils/article-rules.js'
import { getDatabase } from '../utils/database.js'

const LOCALES = new Set(['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'])

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const requested = String(query.locale || 'en')
  const locale = LOCALES.has(requested) && requested === 'ru' ? 'ru' : 'en'
  const overrides = await loadArticleRuleOverrides(getDatabase())
  return {
    rules: presentArticleRules(overrides, locale),
    baseline: articleRuleBaseline(locale),
  }
})
