import { repairEmphasis, translateMarkdown, keepsNumbers, maskNumbers, unmaskNumbers, pickMyMemoryTranslation } from '../../server/utils/translate.js'
import { translationLostNumbers } from '../../server/utils/translate-page.js'

export async function run({ assert }) {
  assert.equal(repairEmphasis('**частицы галлия** — они', '** gallium particles ** — they'), '**gallium particles** — they')
  assert.equal(repairEmphasis('назвали **STERS** (*spatial*)', 'named** STERS **(* spatial *)'), 'named **STERS** (*spatial*)')
  assert.equal(repairEmphasis('назвали **STERS** (*spatial*)', 'named** sters * * (* spatial*)'), 'named sters (spatial)')
  assert.equal(repairEmphasis('без разметки', 'no marks'), 'no marks')

  const sent = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const text = new URL(url).searchParams.get('q')
    sent.push(text)
    const translatedText = `EN ${text.replace(/\*\*(.+?)\*\*/g, '** $1 **')}`
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText } }), { status: 200 })
  }
  try {
    const body = [
      'Вступление с *Matter*[^paper].',
      '## Как это работает',
      '- **частицы галлия** — источник;\n- **мономеры** — блоки.',
      '> [!NOTE]\n> **Коротко:** вспышка света.',
      '```js\nconst x = 1\n```',
      '[^paper]: Статья в журнале.',
    ].join('\n\n')
    const { body: result } = await translateMarkdown({ body, sourceLocale: 'ru', targetLocale: 'en' })
    const blocks = result.split('\n\n')
    assert.equal(blocks[1], '## EN Как это работает')
    assert.equal(blocks[2], '- EN **частицы галлия** — источник;\n- EN **мономеры** — блоки.')
    assert.equal(blocks[3], '> [!NOTE]\n> EN **Коротко:** вспышка света.')
    assert.equal(blocks[4], '```js\nconst x = 1\n```')
    assert.equal(blocks[5], '[^paper]: EN Статья в журнале.')
    assert.ok(!sent.some(text => /^(##|- |> |\[\^)/.test(text)), 'block marks are not sent to the translator')
  } finally {
    globalThis.fetch = originalFetch
  }

  // MyMemory once answered "Что такое 67?" with the memory hit for "Что такое?".
  const payload = {
    responseData: { translatedText: 'What is it?', match: 0.86 },
    matches: [
      { segment: 'Что такое?', translation: 'What is it?', 'created-by': 'MateCat' },
      { segment: 'Что такое 67?', translation: 'What is 67?', 'created-by': 'MT!' },
    ],
  }
  assert.equal(pickMyMemoryTranslation('Что такое 67?', payload), 'What is 67?')
  assert.equal(pickMyMemoryTranslation('Что такое 67?', { responseData: { translatedText: 'What is it?' }, matches: [{ segment: 'Что такое?', translation: 'What is it?', 'created-by': 'MateCat' }] }), 'What is it?', 'without a better hit the answer is kept and checked later')
  assert.equal(keepsNumbers('Что такое 67?', 'What is it?'), false)
  assert.equal(keepsNumbers('В 2026 году 1,5 млн', 'In 2026 there are 1,5 million'), true)
  const masked = maskNumbers('Что такое 67 и 2026?')
  assert.equal(masked.masked, 'Что такое AIKI-NUM-1 и AIKI-NUM-2?')
  assert.equal(unmaskNumbers('What are AIKI-NUM-1 and AIKI-NUM-2?', masked.numbers), 'What are 67 and 2026?')

  // A stored translation that dropped numbers from the title is redone.
  assert.equal(translationLostNumbers({ title: 'Что такое 67?' }, { machine_title: 'What is it?' }), true)
  assert.equal(translationLostNumbers({ title: 'Что такое 67?' }, { machine_title: 'What is 67?' }), false)
  assert.equal(translationLostNumbers({ title: 'Рост 1,5 млн' }, { machine_title: 'Growth of 1.5 million' }), false, 'a changed decimal separator is not a loss')
}
