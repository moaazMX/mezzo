-- Consolidated fixes for UX and Data consistency

-- 1. Fix Coupon RLS
ALTER TABLE device_coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon to manage their coupons" ON device_coupons;
CREATE POLICY "Allow anon to manage their coupons"
  ON device_coupons FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 2. "Freeze" order data by adding snapshot columns to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS customer_name text,
ADD COLUMN IF NOT EXISTS customer_phone text,
ADD COLUMN IF NOT EXISTS customer_secondary_phone text,
ADD COLUMN IF NOT EXISTS customer_street text,
ADD COLUMN IF NOT EXISTS customer_area text,
ADD COLUMN IF NOT EXISTS customer_city text,
ADD COLUMN IF NOT EXISTS customer_apartment text,
ADD COLUMN IF NOT EXISTS customer_floor text,
ADD COLUMN IF NOT EXISTS customer_building_number text,
ADD COLUMN IF NOT EXISTS customer_landmark text,
ADD COLUMN IF NOT EXISTS customer_latitude double precision,
ADD COLUMN IF NOT EXISTS customer_longitude double precision;

-- 3. Add customer_update_flag to track customer modifications
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS customer_update_flag boolean DEFAULT false;

-- 4. Add secondary_phone to customers table for persistence
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS secondary_phone text;

-- Update existing orders with current customer data (one-time fix)
UPDATE orders o
SET 
  customer_name = c.name,
  customer_phone = c.phone,
  customer_street = c.street,
  customer_area = c.area,
  customer_city = c.city,
  customer_latitude = c.latitude,
  customer_longitude = c.longitude
FROM customers c
WHERE o.customer_id = c.id
  AND o.customer_name IS NULL;
