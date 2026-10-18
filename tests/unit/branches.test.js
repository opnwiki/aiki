import { isReservedSlug, normalizeBranchSlug, preferredLocale, validateBranch } from '../../server/utils/validation.js'

export function run({ assert }) {
  assert.equal(isReservedSlug('branches'), true)
  const named = validateBranch({ title: 'История знаний', description: 'Про источники' })
  assert.equal(named.ok, true)
  assert.equal(named.value.slug, 'история-знаний')
  assert.equal(named.value.description, 'Про источники')
  assert.equal(validateBranch({ title: 'A' }).ok, false)
  assert.equal(validateBranch({ title: 'Maps', description: 'x'.repeat(501) }).ok, false)
  assert.equal(validateBranch({ title: '---' }).ok, false)
  assert.equal(normalizeBranchSlug(' History-Notes '), 'history-notes')
  assert.equal(normalizeBranchSlug('../admin'), null)
  assert.equal(normalizeBranchSlug(''), null)
  assert.equal(preferredLocale('ru'), 'ru')
  assert.equal(preferredLocale('nope'), 'en')
  assert.equal(preferredLocale(''), 'en')
}
