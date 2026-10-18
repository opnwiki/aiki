import { createError } from 'h3'
import { getDatabase } from './database.js'

const WPG_BALANCE_QUERY = `SELECT coalesce(sum(amount), 0)::text AS balance
                            FROM actor_token_ledger
                           WHERE actor_id = $1`
const WPG_HISTORY_QUERY = `SELECT amount::text AS amount, reason, source_type, source_id,
                                  description, created_at
                             FROM actor_token_ledger
                            WHERE actor_id = $1
                            ORDER BY created_at DESC, id DESC
                            LIMIT $2`

export async function getActorTokenAccount(database, actorId, { historyLimit = 20 } = {}) {
  const limit = Math.min(Math.max(Number(historyLimit) || 20, 1), 50)
  const result = await database.query(WPG_BALANCE_QUERY, [actorId])
  const history = await database.query(WPG_HISTORY_QUERY, [actorId, limit])
  const balance = Number(result.rows[0]?.balance ?? 0)
  if (!Number.isSafeInteger(balance)) throw createError({ statusCode: 503, statusMessage: 'Token balance is temporarily unavailable.' })
  return {
    ticker: 'WPG',
    balance,
    redemptionEnabled: false,
    history: history.rows.map(row => ({
      amount: Number(row.amount),
      reason: row.reason,
      sourceType: row.source_type,
      sourceId: row.source_id,
      description: row.description,
      createdAt: row.created_at,
    })),
  }
}

export async function getActorTokenAccountFromDatabase(actorId, options) {
  return await getActorTokenAccount(getDatabase(), actorId, options)
}

export function canEarnAcceptedSubmission({ kind, taskStatus, submissionAuthorId, reviewerId }) {
  return kind === 'article'
    && taskStatus === 'submitted'
    && typeof submissionAuthorId === 'string'
    && typeof reviewerId === 'string'
    && submissionAuthorId !== reviewerId
}

export function wpgRewardForAcceptedSubmission(submission) {
  if (submission?.kind === 'article' && submission?.taskStatus === 'accepted' && submission?.independentlyReviewed === true) {
    return { amount: 1, reason: 'article_accepted' }
  }
  return null
}
