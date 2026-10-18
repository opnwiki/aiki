-- Optional communities. A page may belong to one branch or to none.
-- The creator is the first leader. Further leaders and moderators are stored
-- in branch_roles and are not appointed from the product UI yet.

CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES actors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT branches_title_len CHECK (char_length(title) BETWEEN 2 AND 80),
  CONSTRAINT branches_description_len CHECK (char_length(description) <= 500)
);

CREATE TABLE IF NOT EXISTS branch_roles (
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('leader', 'moderator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, actor_id)
);

CREATE INDEX IF NOT EXISTS branch_roles_actor_idx ON branch_roles (actor_id, role);

ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS topics_branch_created_idx ON topics (branch_id, created_at DESC);
