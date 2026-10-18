-- The header shows a name and icon chosen by the node owner or an admin.
-- A blank name means the default word "AiKi". A missing icon means the built-in mark.

ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS brand_icon BYTEA,
  ADD COLUMN IF NOT EXISTS brand_icon_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nodes_display_name_len') THEN
    ALTER TABLE nodes ADD CONSTRAINT nodes_display_name_len
      CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nodes_brand_icon_type') THEN
    ALTER TABLE nodes ADD CONSTRAINT nodes_brand_icon_type
      CHECK (brand_icon_type IS NULL OR brand_icon_type IN ('image/png', 'image/jpeg', 'image/webp'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nodes_brand_icon_pair') THEN
    ALTER TABLE nodes ADD CONSTRAINT nodes_brand_icon_pair
      CHECK ((brand_icon IS NULL) = (brand_icon_type IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nodes_brand_icon_size') THEN
    ALTER TABLE nodes ADD CONSTRAINT nodes_brand_icon_size
      CHECK (brand_icon IS NULL OR octet_length(brand_icon) BETWEEN 1 AND 512000);
  END IF;
END $$;
