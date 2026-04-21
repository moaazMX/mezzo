/*
  # Coupons & Device Rewards

  ## New Tables
  - device_coupons: coupons earned by a specific device (via device_fingerprint)

  ## Changes
  - Add optional coupon fields to orders table so we can record which coupon was used
  - Extend settings RLS policy to allow reading coupon configuration keys from the client
*/

-- Create device_coupons table
CREATE TABLE IF NOT EXISTS device_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_fingerprint text NOT NULL,
  code text NOT NULL,
  discount_percent integer NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  is_used boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_coupons_device ON device_coupons(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_device_coupons_code ON device_coupons(code);
CREATE INDEX IF NOT EXISTS idx_device_coupons_used ON device_coupons(is_used);

-- Add coupon fields to orders table
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS applied_coupon_id uuid REFERENCES device_coupons(id) ON DELETE SET NULL;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS applied_coupon_code text DEFAULT '';

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS applied_coupon_discount_percent integer DEFAULT 0;

-- Allow reading coupon configuration from settings
DO $$
BEGIN
  -- Try to update existing policy if it exists
  BEGIN
    DROP POLICY IF EXISTS "Allow public read access to settings" ON settings;
  EXCEPTION
    WHEN undefined_object THEN
      -- Policy might not exist yet, ignore
      NULL;
  END;

  CREATE POLICY "Allow public read access to settings"
    ON settings FOR SELECT
    TO anon, authenticated
    USING (key IN (
      'instant_transfer_number',
      'coupon_secret_code',
      'coupon_discount_percent'
    ));
END $$;

-- Insert default coupon configuration (disabled by default with empty code)
INSERT INTO settings (key, value) VALUES
  ('coupon_secret_code', ''),
  ('coupon_discount_percent', '10')
ON CONFLICT (key) DO NOTHING;

