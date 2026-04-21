-- Migration: Add GPS location fields to customers and archive_orders

-- Add GPS location fields to customers table
ALTER TABLE customers 
  ADD COLUMN IF NOT EXISTS latitude decimal(10,8),
  ADD COLUMN IF NOT EXISTS longitude decimal(11,8);

-- Add GPS location fields to archive_orders table
ALTER TABLE archive_orders 
  ADD COLUMN IF NOT EXISTS customer_latitude decimal(10,8),
  ADD COLUMN IF NOT EXISTS customer_longitude decimal(11,8);

-- Create index for location queries (optional, for future use)
CREATE INDEX IF NOT EXISTS idx_customers_location 
  ON customers(latitude, longitude) 
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

COMMENT ON COLUMN customers.latitude IS 'Customer GPS latitude coordinate';
COMMENT ON COLUMN customers.longitude IS 'Customer GPS longitude coordinate';
COMMENT ON COLUMN archive_orders.customer_latitude IS 'Customer GPS latitude at time of archiving';
COMMENT ON COLUMN archive_orders.customer_longitude IS 'Customer GPS longitude at time of archiving';
