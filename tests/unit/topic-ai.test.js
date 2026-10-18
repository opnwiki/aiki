import { buildTopicAiPrompt, parseTopicAiResult, readPublicUsefulnessScore, topicAiRepairSchema } from '../../server/utils/topic-ai.js'

export async function run({ assert }) {
  const prompt = buildTopicAiPrompt({
    requestType: 'research',
    locale: 'ru',
    title: 'Как работает проверяемая статья',
    body: 'Основной текст статьи.',
    summary: 'Краткое описание.',
    replies: [{ author: 'reader', body: 'Нужны источники.' }],
    instruction: 'Сравни два подхода.',
  })
  assert.match(prompt, /Return JSON only/)
  assert.match(prompt, /Сравни два подхода/)
  assert.match(prompt, /<discussion>/)

  const discussionPrompt = buildTopicAiPrompt({
    requestType: 'discussion_reply',
    locale: 'ru',
    title: 'Страница',
    body: 'Текст страницы.',
  })
  assert.match(discussionPrompt, /published automatically/)

  const overviewPrompt = buildTopicAiPrompt({
    requestType: 'overview',
    locale: 'ru',
    title: 'Страница',
    body: 'Полный текст страницы.',
    summary: 'Старый обзор.',
    replies: [{ author: 'reader', body: 'В обсуждении есть уточнение.' }],
  })
  assert.match(overviewPrompt, /short substantive retelling/)
  assert.match(overviewPrompt, /short substantive retelling of the key points, conclusions, and important context/)
  assert.match(overviewPrompt, /not a description of the page/)
  assert.match(overviewPrompt, /"overview"/)

  const classificationPrompt = buildTopicAiPrompt({
    requestType: 'classify_page',
    locale: 'ru',
    title: 'Что такое проверяемая страница?',
    body: 'Страница создана из поискового запроса.',
    sourceText: 'Что такое проверяемая страница?',
  })
  assert.match(classificationPrompt, /classify_page/)
  assert.match(classificationPrompt, /<original-submitted-text>/)
  assert.match(classificationPrompt, /publicUsefulnessScore/)
  assert.match(classificationPrompt, /Personal topics must stay below 50.00/)
  assert.match(classificationPrompt, /Do not confuse public access with public usefulness/)
  assert.deepEqual(parseTopicAiResult({ kind: 'question', reason: 'Заголовок явно сформулирован как вопрос.' }, 'classify_page'), {
    requestType: 'classify_page',
    kind: 'question',
    locale: null,
    reason: 'Заголовок явно сформулирован как вопрос.',
    tags: [],
    publish: false,
    publishReason: '',
    publicUsefulnessScore: null,
    publicUsefulnessReason: '',
  }, 'without an explicit publish: true the page stays by link')
  const clean = parseTopicAiResult({ kind: 'article', locale: 'ru', publish: true, tags: ['наука'] }, 'classify_page')
  assert.equal(clean.publish, true)
  assert.equal(clean.locale, 'ru')
  assert.equal(parseTopicAiResult({ kind: 'page', locale: 'ru' }, 'classify_page').kind, 'page')
  assert.equal(parseTopicAiResult({ kind: 'article', language: 'de' }, 'classify_page').locale, 'de')
  assert.equal(parseTopicAiResult({ kind: 'article', locale: 'xx' }, 'classify_page').locale, null)
  assert.equal(parseTopicAiResult({ kind: 'article', publish: 'yes' }, 'classify_page').publish, false)
  const useful = parseTopicAiResult({ kind: 'discussion', publicUsefulnessScore: '78.256', publicUsefulnessReason: 'Знания полезны другим людям.' }, 'classify_page')
  assert.equal(useful.publicUsefulnessScore, 78.26)
  assert.equal(useful.publicUsefulnessReason, 'Знания полезны другим людям.')
  assert.equal(readPublicUsefulnessScore(0), 0)
  assert.equal(readPublicUsefulnessScore(100), 100)
  for (const invalid of [-0.01, 100.01, NaN, Infinity, '', 'bad', true, [], {}]) {
    assert.throws(() => parseTopicAiResult({ kind: 'question', publicUsefulnessScore: invalid }, 'classify_page'), /invalid public usefulness score/)
  }
  assert.match(topicAiRepairSchema('classify_page'), /publicUsefulnessScore/)

  const research = parseTopicAiResult({
    proposedBody: 'Полный текст статьи с проверяемым дополнением и источниками.',
    rationale: 'Добавлен проверяемый контекст.',
    sources: [],
  }, 'research')
  assert.equal(research.proposedBody, 'Полный текст статьи с проверяемым дополнением и источниками.')
  assert.deepEqual(research.sources, [])

  const answer = parseTopicAiResult({ answer: 'Проверяемое объяснение.', sources: [] }, 'question_answer')
  assert.equal(answer.answer, 'Проверяемое объяснение.')
  assert.deepEqual(answer.sources, [])

  const overview = parseTopicAiResult({ overview: 'Новый краткий обзор страницы с учетом текста и обсуждения.', sources: [] }, 'overview')
  assert.equal(overview.overview, 'Новый краткий обзор страницы с учетом текста и обсуждения.')
  assert.match(topicAiRepairSchema('research'), /proposedBody/)
  assert.throws(
    () => parseTopicAiResult('{not-json}', 'research'),
    error => error.status === 422 && /invalid JSON/.test(error.message),
  )

  const supplement = parseTopicAiResult({
    proposedBody: 'Полный обновлённый текст статьи с дополнением.',
    rationale: 'Добавлен проверяемый контекст.',
    sources: [{ url: 'https://example.com/source', title: 'Source' }],
  }, 'supplement')
  assert.equal(supplement.proposedBody, 'Полный обновлённый текст статьи с дополнением.')
  assert.equal(supplement.sources[0].url, 'https://example.com/source')
  assert.throws(() => parseTopicAiResult({ answer: '' }, 'question_answer'), /empty answer/)
}
