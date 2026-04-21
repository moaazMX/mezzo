-- Add delivery_method to orders and archive_orders tables
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS delivery_method text DEFAULT 'delivery';
ALTER TABLE IF EXISTS archive_orders ADD COLUMN IF NOT EXISTS delivery_method text DEFAULT 'delivery';
