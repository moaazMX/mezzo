-- Add default_pickup_time to customers table
ALTER TABLE IF EXISTS customers 
ADD COLUMN IF NOT EXISTS default_pickup_time TEXT;

-- Comments for clarity
COMMENT ON COLUMN customers.default_pickup_time IS 'The customer default preferred pickup time (e.g., "03:30 PM")';
