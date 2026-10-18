-- Button accent colors chosen by the node owner or an admin.
-- NULL keeps the calm built-in color for that theme.

ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS accent_light TEXT,
  ADD COLUMN IF NOT EXISTS accent_dark TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nodes_accent_light_hex') THEN
    ALTER TABLE nodes ADD CONSTRAINT nodes_accent_light_hex
      CHECK (accent_light IS NULL OR accent_light ~ '^#[0-9a-f]{6}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nodes_accent_dark_hex') THEN
    ALTER TABLE nodes ADD CONSTRAINT nodes_accent_dark_hex
      CHECK (accent_dark IS NULL OR accent_dark ~ '^#[0-9a-f]{6}$');
  END IF;
END $$;
