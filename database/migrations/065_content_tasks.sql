-- Unified work queue for people and agents. The older article_writing_tasks
-- table remains available as a compatibility layer while clients migrate.
CREATE TABLE IF NOT EXISTS content_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  base_revision_id UUID REFERENCES revisions(id) ON DELETE SET NULL,
  creator_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL CHECK (task_type IN (
    'edit_article', 'answer_question', 'translate', 'update_overview',
    'write_article', 'write_discussion'
  )),
  reason TEXT NOT NULL DEFAULT 'manual',
  source_locale TEXT REFERENCES locales(lang),
  target_locale TEXT REFERENCES locales(lang),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'claimed', 'submitted', 'under_review', 'resolved'
  )),
  claim_actor_label TEXT,
  claimed_by UUID REFERENCES actors(id) ON DELETE SET NULL,
  claim_expires_at TIMESTAMPTZ,
  cycle_no INTEGER NOT NULL DEFAULT 1 CHECK (cycle_no > 0),
  auto_publish_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  last_promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (task_type IN ('write_article', 'write_discussion') OR topic_id IS NOT NULL),
  CHECK (status <> 'claimed' OR (claimed_by IS NOT NULL AND claim_expires_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS content_tasks_idempotency_idx
  ON content_tasks (
    coalesce(topic_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(base_revision_id, '00000000-0000-0000-0000-000000000000'::uuid),
    task_type, reason, coalesce(source_locale, ''), coalesce(target_locale, ''), cycle_no
  ) WHERE topic_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_tasks_queue_idx
  ON content_tasks (status, task_type, created_at DESC);
CREATE INDEX IF NOT EXISTS content_tasks_topic_idx
  ON content_tasks (topic_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS content_task_solutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES content_tasks(id) ON DELETE CASCADE,
  cycle_no INTEGER NOT NULL CHECK (cycle_no > 0),
  submitted_by UUID REFERENCES actors(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
  model_name TEXT,
  client_label TEXT,
  provider_cost JSONB,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'accepted', 'rejected', 'partially_accepted'
  )),
  auto_accept_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES actors(id) ON DELETE SET NULL,
  review_comment TEXT,
  result_revision_id UUID REFERENCES revisions(id) ON DELETE SET NULL,
  result_reply_id UUID REFERENCES replies(id) ON DELETE SET NULL,
  result_topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS content_task_solutions_task_idx
  ON content_task_solutions (task_id, cycle_no, created_at DESC);
CREATE INDEX IF NOT EXISTS content_task_solutions_auto_accept_idx
  ON content_task_solutions (auto_accept_at)
  WHERE status = 'submitted' AND auto_accept_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS content_task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES content_tasks(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_task_events_task_idx
  ON content_task_events (task_id, created_at DESC);

COMMENT ON TABLE content_tasks IS 'Unified human and agent work queue. Automatic quality tasks use reason and base_revision_id for idempotency.';
COMMENT ON COLUMN content_tasks.auto_publish_allowed IS 'Explicit rejection or partial review disables the 24-hour automatic acceptance for later cycles.';

-- Seed the queue for already-published material as well as pages created after
-- this migration. The expression-based unique index makes this re-runnable.
INSERT INTO content_tasks (node_id, topic_id, base_revision_id, creator_id, task_type, reason, source_locale)
SELECT topic.node_id, topic.id, current.revision_id, topic.author_id, 'update_overview', 'missing_overview', revision.locale
  FROM topics topic
  JOIN topic_current_revisions current ON current.topic_id = topic.id
  JOIN revisions revision ON revision.id = current.revision_id
 WHERE topic.kind = 'article'
   AND topic.status IN ('published', 'unlisted', 'hidden')
   AND coalesce(nullif(btrim(topic.summary), ''), nullif(btrim(revision.summary), '')) IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO content_tasks (node_id, topic_id, base_revision_id, creator_id, task_type, reason, source_locale)
SELECT topic.node_id, topic.id, current.revision_id, topic.author_id, 'edit_article', reason.reason, revision.locale
  FROM topics topic
  JOIN topic_current_revisions current ON current.topic_id = topic.id
  JOIN revisions revision ON revision.id = current.revision_id
  CROSS JOIN LATERAL (VALUES
    ('insufficient_body', length(regexp_replace(revision.body_markdown, '\s+', '', 'g')) < 400),
    ('missing_sources', NOT EXISTS (SELECT 1 FROM citations WHERE revision_id = revision.id))
  ) AS reason(reason, missing)
 WHERE topic.kind = 'article'
   AND topic.status IN ('published', 'unlisted', 'hidden')
   AND reason.missing
ON CONFLICT DO NOTHING;

INSERT INTO content_tasks (node_id, topic_id, base_revision_id, creator_id, task_type, reason, source_locale)
SELECT topic.node_id, topic.id, current.revision_id, topic.author_id, 'answer_question', 'no_answer', revision.locale
  FROM topics topic
  JOIN topic_current_revisions current ON current.topic_id = topic.id
  JOIN revisions revision ON revision.id = current.revision_id
 WHERE topic.kind = 'question'
   AND topic.status IN ('published', 'unlisted', 'hidden')
   AND NOT EXISTS (SELECT 1 FROM replies WHERE topic_id = topic.id AND status = 'published')
ON CONFLICT DO NOTHING;

INSERT INTO content_tasks (node_id, topic_id, base_revision_id, creator_id, task_type, reason, source_locale, target_locale)
SELECT topic.node_id, snapshot.topic_id, snapshot.revision_id, topic.author_id, 'translate', 'translation_review', source.locale, snapshot.locale
  FROM translation_snapshots snapshot
  JOIN topics topic ON topic.id = snapshot.topic_id
  JOIN revisions revision ON revision.id = snapshot.revision_id
  JOIN revisions source ON source.id = snapshot.source_revision_id
  JOIN topic_current_revisions current ON current.topic_id = snapshot.topic_id
    AND current.locale = snapshot.locale AND current.revision_id = snapshot.revision_id
 WHERE topic.status IN ('published', 'unlisted', 'hidden')
   AND snapshot.machine_title IS NOT DISTINCT FROM revision.title
   AND snapshot.machine_body IS NOT DISTINCT FROM revision.body_markdown
ON CONFLICT DO NOTHING;
