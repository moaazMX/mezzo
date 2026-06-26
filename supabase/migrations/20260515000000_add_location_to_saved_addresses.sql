-- Migration: Add latitude and longitude to customer_saved_addresses table
ALTER TABLE customer_saved_addresses 
  ADD COLUMN IF NOT EXISTS latitude decimal(10,8),
  ADD COLUMN IF NOT EXISTS longitude decimal(11,8);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_customer_saved_addresses_location
  ON customer_saved_addresses(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

COMMENT ON COLUMN customer_saved_addresses.latitude IS 'Saved address GPS latitude coordinate';
COMMENT ON COLUMN customer_saved_addresses.longitude IS 'Saved address GPS longitude coordinate';
