-- Add DELETE policies for archive tables
-- This allows anon and authenticated users to delete archive data (for system reset)
-- Note: The system uses localStorage for auth, so users are "anon" in Supabase

-- Delete policy for archive_orders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'archive_orders' 
    AND policyname = 'Allow public delete access to archive_orders'
  ) THEN
    CREATE POLICY "Allow public delete access to archive_orders"
      ON archive_orders FOR DELETE
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

-- Delete policy for archive_order_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'archive_order_items' 
    AND policyname = 'Allow public delete access to archive_order_items'
  ) THEN
    CREATE POLICY "Allow public delete access to archive_order_items"
      ON archive_order_items FOR DELETE
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

-- Delete policy for archive_customer_notes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'archive_customer_notes' 
    AND policyname = 'Allow public delete access to archive_customer_notes'
  ) THEN
    CREATE POLICY "Allow public delete access to archive_customer_notes"
      ON archive_customer_notes FOR DELETE
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

COMMENT ON POLICY "Allow public delete access to archive_orders" ON archive_orders IS 'Allows anon and authenticated users to delete archive orders (for system reset)';
COMMENT ON POLICY "Allow public delete access to archive_order_items" ON archive_order_items IS 'Allows anon and authenticated users to delete archive order items (for system reset)';
COMMENT ON POLICY "Allow public delete access to archive_customer_notes" ON archive_customer_notes IS 'Allows anon and authenticated users to delete archive customer notes (for system reset)';
