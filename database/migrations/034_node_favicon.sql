-- The header mark may be an SVG. A separate image is the browser tab icon
-- and the installed app icon. Both stay optional; null keeps the built-in files.

ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_brand_icon_type;
ALTER TABLE nodes
  ADD CONSTRAINT nodes_brand_icon_type
  CHECK (brand_icon_type IS NULL OR brand_icon_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'));

ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS brand_favicon BYTEA,
  ADD COLUMN IF NOT EXISTS brand_favicon_type TEXT;

ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_brand_favicon_type;
ALTER TABLE nodes
  ADD CONSTRAINT nodes_brand_favicon_type
  CHECK (brand_favicon_type IS NULL OR brand_favicon_type IN ('image/png', 'image/jpeg', 'image/webp'));

ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_brand_favicon_pair;
ALTER TABLE nodes
  ADD CONSTRAINT nodes_brand_favicon_pair
  CHECK ((brand_favicon IS NULL) = (brand_favicon_type IS NULL));

ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_brand_favicon_size;
ALTER TABLE nodes
  ADD CONSTRAINT nodes_brand_favicon_size
  CHECK (brand_favicon IS NULL OR octet_length(brand_favicon) BETWEEN 1 AND 512000);
