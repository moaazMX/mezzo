ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pickup_deadline_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pickup_commitment_kind text NULL,
  ADD COLUMN IF NOT EXISTS pickup_commitment_ack boolean NULL,
  ADD COLUMN IF NOT EXISTS pickup_commitment_label text NULL;

CREATE INDEX IF NOT EXISTS idx_orders_pickup_deadline_at
  ON orders(pickup_deadline_at);
