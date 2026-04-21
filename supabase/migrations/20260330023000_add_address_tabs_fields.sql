ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS address_type text,
  ADD COLUMN IF NOT EXISTS address_label text,
  ADD COLUMN IF NOT EXISTS house_name text,
  ADD COLUMN IF NOT EXISTS company_name text;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_address_type text,
  ADD COLUMN IF NOT EXISTS customer_address_label text,
  ADD COLUMN IF NOT EXISTS customer_house_name text,
  ADD COLUMN IF NOT EXISTS customer_company_name text;

ALTER TABLE archive_orders
  ADD COLUMN IF NOT EXISTS customer_address_type text,
  ADD COLUMN IF NOT EXISTS customer_address_label text,
  ADD COLUMN IF NOT EXISTS customer_house_name text,
  ADD COLUMN IF NOT EXISTS customer_company_name text;
