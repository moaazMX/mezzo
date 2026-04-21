-- Migration: Create customer general notes table
-- This table stores operator notes for customers by phone and name
-- These notes will appear on all new orders for matching customers

-- Create customer_general_notes table
CREATE TABLE IF NOT EXISTS customer_general_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone text NOT NULL,
  customer_name text NOT NULL,
  note text NOT NULL,
  created_by text DEFAULT 'operator',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index for faster lookups by phone and name
CREATE INDEX IF NOT EXISTS idx_customer_general_notes_phone_name 
  ON customer_general_notes(customer_phone, customer_name);

-- Create index for phone only (for partial matches)
CREATE INDEX IF NOT EXISTS idx_customer_general_notes_phone 
  ON customer_general_notes(customer_phone);

-- Enable RLS
ALTER TABLE customer_general_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Allow public read access to customer_general_notes"
  ON customer_general_notes FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert access to customer_general_notes"
  ON customer_general_notes FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update access to customer_general_notes"
  ON customer_general_notes FOR UPDATE
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public delete access to customer_general_notes"
  ON customer_general_notes FOR DELETE
  TO anon, authenticated
  USING (true);

-- Function to get customer general notes by phone and name
CREATE OR REPLACE FUNCTION get_customer_general_notes(
  p_phone text,
  p_name text
)
RETURNS TABLE (
  id uuid,
  customer_phone text,
  customer_name text,
  note text,
  created_by text,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cgn.id,
    cgn.customer_phone,
    cgn.customer_name,
    cgn.note,
    cgn.created_by,
    cgn.created_at
  FROM customer_general_notes cgn
  WHERE cgn.customer_phone = p_phone
    AND cgn.customer_name = p_name
  ORDER BY cgn.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to automatically copy general notes to new orders
-- This function can be called after order creation
CREATE OR REPLACE FUNCTION copy_general_notes_to_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_customer_phone text,
  p_customer_name text
)
RETURNS void AS $$
DECLARE
  note_record RECORD;
BEGIN
  -- Get all general notes for this customer (by phone and name)
  FOR note_record IN 
    SELECT * FROM customer_general_notes
    WHERE customer_phone = p_customer_phone
      AND customer_name = p_customer_name
    ORDER BY created_at DESC
  LOOP
    -- Insert note into customer_notes for this order
    INSERT INTO customer_notes (
      customer_id,
      order_id,
      note,
      created_by
    ) VALUES (
      p_customer_id,
      p_order_id,
      note_record.note,
      note_record.created_by
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger function to automatically copy notes when order is created
-- Note: This requires the order to have customer_id, and we need customer phone/name
-- So we'll handle this in application code instead of trigger
-- But we keep the function available for manual calls

COMMENT ON TABLE customer_general_notes IS 'Stores operator notes for customers by phone and name. These notes appear on all new orders for matching customers.';
COMMENT ON FUNCTION get_customer_general_notes IS 'Returns all general notes for a customer matching phone and name';
COMMENT ON FUNCTION copy_general_notes_to_order IS 'Copies all general notes for a customer to a specific order';
