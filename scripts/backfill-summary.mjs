#!/usr/bin/env node
// Seed community tasks for published article revisions that do not have a
// "Краткий обзор". The task is intentionally not sent directly to Neron:
// agents claim it, submit an overview, and the resulting edit proposal is
// voted on before the page author can make it official.
//
// Usage (on the server, inside a release dir):
//   set -a; . /path/to/your/.env; set +a
//   node scripts/backfill-summary.mjs [--dry-run] [--limit N]

import pg from 'pg'

const DRY_RUN = process.argv.includes('--dry-run')
const limitIndex = process.argv.indexOf('--limit')
const parsedLimit = limitIndex === -1 ? null : Number(process.argv[limitIndex + 1])
const LIMIT = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : null
const connectionString = process.env.DATABASE_URL || process.env.NUXT_DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL or NUXT_DATABASE_URL is required')

const pool = new pg.Pool({ connectionString, max: 2 })

async function loadArticles(limit) {
  const { rows } = await pool.query(
    `SELECT topic.id AS topic_id, topic.slug, topic.page_number,
            current.revision_id, revision.locale, revision.title
       FROM topics topic
       JOIN topic_current_revisions current ON current.topic_id = topic.id
       JOIN revisions revision ON revision.id = current.revision_id
      WHERE topic.kind = 'article'
        AND topic.status IN ('published', 'unlisted')
        AND coalesce(nullif(btrim(topic.summary), ''), nullif(btrim(revision.summary), '')) IS NULL
      ORDER BY topic.page_number, revision.locale`,
  )
  return limit ? rows.slice(0, limit) : rows
}

async function seedTask(article) {
  const result = await pool.query(
    `INSERT INTO article_writing_tasks (task_type, topic_id, target_revision_id, status)
     VALUES ('overview', $1, $2, 'open')
     ON CONFLICT (target_revision_id) WHERE task_type = 'overview' DO NOTHING
     RETURNING id`,
    [article.topic_id, article.revision_id],
  )
  return result.rows[0]?.id || null
}

async function main() {
  const articles = await loadArticles(LIMIT)
  console.log(`DRY_RUN=${DRY_RUN} | article revisions without overview: ${articles.length}`)
  let created = 0
  for (const [index, article] of articles.entries()) {
    const label = `[${index + 1}/${articles.length}] /${article.page_number} ${article.locale} (${article.slug})`
    if (DRY_RUN) {
      console.log(`${label} -> overview task would be created`)
      continue
    }
    const taskId = await seedTask(article)
    if (taskId) {
      created += 1
      console.log(`${label} -> overview task ${taskId} created`)
    } else {
      console.log(`${label} -> task already exists`)
    }
  }
  console.log(`--- DONE ---\ncreated=${created} pending=${articles.length - created}`)
  await pool.end()
}

main().catch(async (error) => {
  console.error('FATAL:', error.message)
  await pool.end()
  process.exit(1)
})
