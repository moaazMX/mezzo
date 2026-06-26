-- Item-level rate discount (hidden from operator/customer; visible on /rate page only)

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS rate_discount_percent integer DEFAULT NULL;

ALTER TABLE archive_order_items
  ADD COLUMN IF NOT EXISTS rate_discount_percent integer DEFAULT NULL;

INSERT INTO settings (key, value)
VALUES
  ('rate_page_password', 'moaazMXpl011#'),
  ('item_rate_discount_percent', '25'),
  ('item_rate_discount_amount', '50')
ON CONFLICT (key) 

COMMENT ON COLUMN order_items.rate_discount_percent IS 'Hidden per-item discount % snapshot at order time (rate page only)';
COMMENT ON COLUMN archive_order_items.rate_discount_percent IS 'Hidden per-item discount % snapshot at archive time (rate page only)';
