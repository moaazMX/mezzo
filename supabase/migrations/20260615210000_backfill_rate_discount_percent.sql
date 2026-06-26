-- Backfill rate_discount_percent for existing order items using current setting
UPDATE order_items
SET rate_discount_percent = COALESCE(
  (SELECT NULLIF(value, '')::int FROM settings WHERE key = 'item_rate_discount_percent' LIMIT 1),
  25
)
WHERE rate_discount_percent IS NULL;

UPDATE archive_order_items
SET rate_discount_percent = COALESCE(
  (SELECT NULLIF(value, '')::int FROM settings WHERE key = 'item_rate_discount_percent' LIMIT 1),
  25
)
WHERE rate_discount_percent IS NULL;
