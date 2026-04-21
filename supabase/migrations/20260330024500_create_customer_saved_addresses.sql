CREATE TABLE IF NOT EXISTS customer_saved_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label text NOT NULL,
  address_type text NOT NULL DEFAULT 'custom',
  building_number text,
  street text,
  area text,
  city text,
  floor text,
  apartment text,
  house_name text,
  company_name text,
  landmark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, label)
);

ALTER TABLE customer_saved_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read customer_saved_addresses" ON customer_saved_addresses;
CREATE POLICY "Public can read customer_saved_addresses"
ON customer_saved_addresses FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Public can insert customer_saved_addresses" ON customer_saved_addresses;
CREATE POLICY "Public can insert customer_saved_addresses"
ON customer_saved_addresses FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Public can update customer_saved_addresses" ON customer_saved_addresses;
CREATE POLICY "Public can update customer_saved_addresses"
ON customer_saved_addresses FOR UPDATE
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Public can delete customer_saved_addresses" ON customer_saved_addresses;
CREATE POLICY "Public can delete customer_saved_addresses"
ON customer_saved_addresses FOR DELETE
USING (true);
