-- Owner/admin can hide published page and account counts on the public node page.
ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS show_public_counts BOOLEAN NOT NULL DEFAULT true;
