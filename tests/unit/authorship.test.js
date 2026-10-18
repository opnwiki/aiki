import { markHumanReviewedAuthorship, validateAuthorship } from '../../server/utils/authorship.js'

export function run({ assert }) {
  assert.deepEqual(validateAuthorship({
    authorshipMode: 'human_only',
    humanContribution: 'Written by researcher Jane Doe.',
  }), {
    ok: true,
    errors: {},
    value: {
      authorshipMode: 'human_only',
      modelName: null,
      humanContribution: 'Written by researcher Jane Doe.',
    },
  })

  const collaboration = validateAuthorship({
    authorshipMode: 'human_ai_collaboration',
    modelName: 'Example LLM 4.2',
    humanContribution: 'A human author checked claims, revised the draft, and selected sources.',
  })
  assert.equal(collaboration.ok, true)
  assert.equal(collaboration.value.modelName, 'Example LLM 4.2')

  assert.equal(validateAuthorship({ authorshipMode: 'human_ai_collaboration', modelName: 'Model Z' }).ok, false, 'collaboration must describe the human work')
  assert.equal(validateAuthorship({ authorshipMode: 'ai_generated_human_reviewed', modelName: '' }).ok, false, 'AI-assisted writing must name the model')
  assert.equal(validateAuthorship({ authorshipMode: 'ai_generated_human_reviewed', modelName: '   ' }).ok, false, 'blank model values must be rejected')
  assert.equal(validateAuthorship({ authorshipMode: 'ai_generated_human_reviewed', modelName: ` ${'M'.repeat(161)} ` }).ok, false, 'model disclosure must be bounded after whitespace normalization')
  assert.equal(validateAuthorship({ authorshipMode: 'human_only', modelName: 'Model Z', humanContribution: 'Written by a named person.' }).ok, false)
  assert.equal(validateAuthorship({ authorshipMode: 'ai_generated_unreviewed', modelName: 'Model Z', humanContribution: 'edited by human' }).ok, false)
  assert.equal(validateAuthorship({ authorshipMode: 'made up', modelName: 'Model Z' }).ok, false)

  assert.equal(markHumanReviewedAuthorship('ai_generated_unreviewed', true), 'ai_generated_human_reviewed')
  assert.equal(markHumanReviewedAuthorship('ai_generated_unreviewed', false), 'ai_generated_unreviewed')
  assert.equal(markHumanReviewedAuthorship('ai_generated_human_reviewed', true), 'ai_generated_human_reviewed')
  assert.equal(markHumanReviewedAuthorship('human_only', true), 'human_only')
}
