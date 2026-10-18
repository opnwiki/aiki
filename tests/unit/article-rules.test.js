import { fitArticleToRules, normalizeArticleRuleOverrides, presentArticleRules, reviewArticle } from '../../server/utils/article-rules.js'

const article = {
  title: 'How to read an old map',
  body: 'A published article body with enough detail for the shared rules.',
  sources: [{ url: 'https://example.org/map' }],
  authorshipMode: 'human_only',
  modelName: null,
  humanContribution: 'Ada wrote it.',
}

export async function run({ assert }) {
  const clean = reviewArticle(article, [])
  assert.equal(clean.ok, true)
  assert.equal(clean.rules.some(rule => rule.id === 'sources'), true)

  const secret = reviewArticle({ ...article, body: 'The password: hunter2 stays out of a page.' }, [])
  assert.equal(secret.ok, false)
  assert.equal(secret.findings.some(finding => finding.id === 'no-secrets'), true)

  const fitted = fitArticleToRules({
    ...article,
    title: 'Write ada@example.org',
    body: '# Old heading\nA published article body with enough detail and password: hunter2 inside.',
  }, [])
  assert.equal(fitted.ok, true)
  assert.equal(fitted.adjusted, true)
  assert.equal(fitted.article.title.includes('@'), false)
  assert.equal(fitted.article.body.startsWith('#'), false)
  assert.equal(fitted.article.body.includes('hunter2'), false)

  const allowed = reviewArticle({ ...article, body: 'Mail ada@example.org stays when the node allows it in a long enough sentence.' }, [
    { id: 'no-email', effect: 'allow' },
  ])
  assert.equal(allowed.ok, true)
  assert.equal(allowed.rules.some(rule => rule.id === 'no-email'), false)

  const replaced = presentArticleRules([
    { id: 'sources', effect: 'replace', statement: 'This node asks for a map room source.' },
  ], 'ru')
  assert.equal(replaced.find(rule => rule.id === 'sources').statement, 'This node asks for a map room source.')
  assert.equal(replaced.find(rule => rule.id === 'authorship').statement.includes('кто'), true)

  const phrase = reviewArticle(article, [
    { id: 'node-1', effect: 'forbid', statement: 'Do not use the marker phrase in an article.', match: 'enough detail' },
  ])
  assert.equal(phrase.ok, false)
  const removed = fitArticleToRules(article, [
    { id: 'node-1', effect: 'forbid', statement: 'Do not use the marker phrase in an article.', match: 'enough detail' },
  ])
  assert.equal(removed.ok, true)
  assert.equal(removed.article.body.includes('enough detail'), false)

  const invalid = normalizeArticleRuleOverrides([{ id: 'no-email', effect: 'forbid', statement: 'Not a baseline change.', match: 'mail' }])
  assert.equal(invalid.ok, false)
  const valid = normalizeArticleRuleOverrides([{ id: 'node-1', effect: 'add', statement: 'Name the archive the page came from.' }])
  assert.equal(valid.ok, true)
  assert.equal(valid.value[0].match, undefined)
}
