-- Migration: Add customer data fields to archive_orders table
-- This ensures customer data is preserved in archive even if customer is deleted

-- Add customer data fields to archive_orders
ALTER TABLE archive_orders 
  ADD COLUMN IF NOT EXISTS customer_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_phone text DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_street text DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_area text DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_city text DEFAULT '';

-- Create index for customer phone in archive
CREATE INDEX IF NOT EXISTS idx_archive_orders_customer_phone 
  ON archive_orders(customer_phone);

-- Function to populate customer data when archiving
CREATE OR REPLACE FUNCTION populate_archive_customer_data()
RETURNS TRIGGER AS $$
BEGIN
  -- If customer data is not set, try to get it from customers table
  IF NEW.customer_name = '' OR NEW.customer_name IS NULL THEN
    IF NEW.customer_id IS NOT NULL THEN
      SELECT name, phone, street, area, city
      INTO NEW.customer_name, NEW.customer_phone, NEW.customer_street, NEW.customer_area, NEW.customer_city
      FROM customers
      WHERE id = NEW.customer_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to populate customer data before insert
DROP TRIGGER IF EXISTS trigger_populate_archive_customer_data ON archive_orders;
CREATE TRIGGER trigger_populate_archive_customer_data
  BEFORE INSERT ON archive_orders
  FOR EACH ROW
  EXECUTE FUNCTION populate_archive_customer_data();

COMMENT ON COLUMN archive_orders.customer_name IS 'Customer name at time of archiving';
COMMENT ON COLUMN archive_orders.customer_phone IS 'Customer phone at time of archiving';
COMMENT ON COLUMN archive_orders.customer_street IS 'Customer street at time of archiving';
COMMENT ON COLUMN archive_orders.customer_area IS 'Customer area at time of archiving';
COMMENT ON COLUMN archive_orders.customer_city IS 'Customer city at time of archiving';
