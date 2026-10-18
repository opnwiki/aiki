-- Store the machine Overview separately so translated pages can preserve
-- human edits while showing the localized summary in the page lead panel.
ALTER TABLE translation_snapshots
  ADD COLUMN IF NOT EXISTS machine_summary TEXT;
