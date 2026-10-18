import { carryHumanEdits, carryTitle } from '../../server/utils/translation-edits.js'

export async function run({ assert }) {
  const machine = 'الحاسوب جهاز.\n\nينفّذ المعالج الأوامر.'
  const published = `${machine}\n\nتصحيح بشري: يُفضَّل مصطلح الكمبيوتر.`
  const next = 'الحاسوب جهاز.\n\nينفّذ المعالج الأوامر.\n\nتُحفظ البيانات. AIKI-MARK-0739'
  const carried = carryHumanEdits(machine, published, next)
  assert.match(carried, /AIKI-MARK-0739/)
  assert.match(carried, /تصحيح بشري: يُفضَّل مصطلح الكمبيوتر\./)
  assert.equal(carryHumanEdits(machine, machine, next), next)
  assert.equal(carryTitle('الحاسوب', 'الكمبيوتر', 'الحاسوب'), 'الكمبيوتر')
  assert.equal(carryTitle('الحاسوب', 'الكمبيوتر', 'حاسوب محدّث'), 'حاسوب محدّث')

  const replaced = carryHumanEdits(
    'الحاسوب جهاز.',
    'الكمبيوتر جهاز.',
    'الحاسوب جهاز.\n\nسطر جديد.',
  )
  assert.match(replaced, /الكمبيوتر جهاز\./)
  assert.match(replaced, /سطر جديد\./)
}
