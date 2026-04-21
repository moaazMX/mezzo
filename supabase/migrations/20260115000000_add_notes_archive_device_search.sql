-- Migration: Add notes, archive, device tracking, and search features

-- 1. Modify customer_notes to support general customer notes (without order_id)
ALTER TABLE customer_notes 
  ALTER COLUMN order_id DROP NOT NULL;

-- Add index for customer notes without order_id
CREATE INDEX IF NOT EXISTS idx_customer_notes_customer_no_order 
  ON customer_notes(customer_id) 
  WHERE order_id IS NULL;

-- 2. Add device fingerprint to customers table
ALTER TABLE customers 
  ADD COLUMN IF NOT EXISTS device_fingerprint text DEFAULT '';

-- Add index for device fingerprint
CREATE INDEX IF NOT EXISTS idx_customers_device_fingerprint 
  ON customers(device_fingerprint);

-- 3. Add order_note field to orders table (for customer notes on order)
ALTER TABLE orders 
  ADD COLUMN IF NOT EXISTS order_note text DEFAULT '';

-- 4. Create archive_orders table
CREATE TABLE IF NOT EXISTS archive_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_order_id uuid,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  order_number text NOT NULL,
  status text DEFAULT 'completed',
  payment_method text NOT NULL,
  total_amount decimal(10,2) NOT NULL,
  cancellation_reason text DEFAULT '',
  cancelled_by text DEFAULT '',
  cancellation_stage text DEFAULT '',
  order_note text DEFAULT '',
  archived_at timestamptz DEFAULT now(),
  original_created_at timestamptz,
  original_updated_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create archive_order_items table
CREATE TABLE IF NOT EXISTS archive_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_order_id uuid REFERENCES archive_orders(id) ON DELETE CASCADE,
  item_id uuid,
  item_name text NOT NULL,
  quantity integer NOT NULL,
  unit_price decimal(10,2) NOT NULL,
  subtotal decimal(10,2) NOT NULL
);

-- Create archive_customer_notes table
CREATE TABLE IF NOT EXISTS archive_customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_order_id uuid REFERENCES archive_orders(id) ON DELETE CASCADE,
  customer_id uuid,
  note text NOT NULL,
  created_by text DEFAULT 'operator',
  created_at timestamptz
);

-- Create indexes for archive tables
CREATE INDEX IF NOT EXISTS idx_archive_orders_customer ON archive_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_archive_orders_order_number ON archive_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_archive_orders_archived_at ON archive_orders(archived_at);
CREATE INDEX IF NOT EXISTS idx_archive_order_items_order ON archive_order_items(archive_order_id);
CREATE INDEX IF NOT EXISTS idx_archive_customer_notes_order ON archive_customer_notes(archive_order_id);

-- Enable RLS on archive tables
ALTER TABLE archive_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_customer_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for archive tables
-- Read access
CREATE POLICY "Allow public read access to archive_orders"
  ON archive_orders FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public read access to archive_order_items"
  ON archive_order_items FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public read access to archive_customer_notes"
  ON archive_customer_notes FOR SELECT
  TO anon, authenticated
  USING (true);

-- Write access (for archiving)
CREATE POLICY "Allow public insert access to archive_orders"
  ON archive_orders FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public insert access to archive_order_items"
  ON archive_order_items FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public insert access to archive_customer_notes"
  ON archive_customer_notes FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
