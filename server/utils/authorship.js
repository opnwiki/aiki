export const AUTHORSHIP_MODES = Object.freeze([
  'human_only',
  'human_ai_collaboration',
  'ai_generated_human_reviewed',
  'ai_generated_unreviewed',
])

export function markHumanReviewedAuthorship(mode, humanReviewed = false) {
  if (humanReviewed && mode === 'ai_generated_unreviewed') return 'ai_generated_human_reviewed'
  return mode || null
}

export function validateAuthorship(input = {}) {
  const mode = String(input.authorshipMode || '')
  const modelName = String(input.modelName || '').replace(/\0/g, '').trim()
  const humanContribution = String(input.humanContribution || '').replace(/\0/g, '').trim()
  const errors = {}

  if (!AUTHORSHIP_MODES.includes(mode)) errors.authorshipMode = 'Choose one of the supported authorship disclosures.'
  if (mode === 'human_only' && modelName) errors.modelName = 'Human-only work must not declare an AI model.'
  if (mode !== 'human_only' && (modelName.length < 1 || modelName.length > 160)) errors.modelName = 'Name the AI model (1–160 characters).'
  if (humanContribution.length > 500) errors.humanContribution = 'Human contribution details must be 500 characters or fewer.'
  if (mode === 'human_ai_collaboration' && !humanContribution) errors.humanContribution = 'Describe the human contribution to this collaboration.'
  if (mode !== 'human_ai_collaboration' && mode !== 'human_only' && humanContribution) errors.humanContribution = 'Use the human contribution field only for a human–AI collaboration.'
  if (mode === 'human_only' && !humanContribution) errors.humanContribution = 'Name or describe the human author of this human-written article.'

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      authorshipMode: mode,
      modelName: mode === 'human_only' ? null : modelName,
      humanContribution: humanContribution || null,
    },
  }
}
