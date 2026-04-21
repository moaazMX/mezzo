/*
  # Coupon expiry & customer binding

  - Adds expiry date to device_coupons
  - Binds coupons to specific customer (id, name, phone)
*/

ALTER TABLE device_coupons
ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE device_coupons
ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE device_coupons
ADD COLUMN IF NOT EXISTS customer_name text;

ALTER TABLE device_coupons
ADD COLUMN IF NOT EXISTS customer_phone text;

