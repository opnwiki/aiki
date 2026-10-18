-- The node owner or an admin can close registration. Sign-in of existing accounts stays available.
ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS registration_open BOOLEAN NOT NULL DEFAULT true;
