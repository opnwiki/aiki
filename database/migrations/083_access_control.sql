-- Per-node request access controls for Statica categories and explicit IPs.
ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS block_threat BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_datacenter BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_scanner BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS node_ip_access_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  ip INET NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, ip),
  CHECK (reason IS NULL OR char_length(reason) <= 240)
);

CREATE INDEX IF NOT EXISTS node_ip_access_blocks_node_idx
  ON node_ip_access_blocks (node_id, created_at DESC);
