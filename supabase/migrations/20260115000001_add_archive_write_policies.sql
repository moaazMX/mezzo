-- Add write policies for archive tables if they don't exist
-- This is a separate migration in case the main migration was already run

-- Check and create insert policies for archive_orders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'archive_orders' 
    AND policyname = 'Allow public insert access to archive_orders'
  ) THEN
    CREATE POLICY "Allow public insert access to archive_orders"
      ON archive_orders FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;
END $$;

-- Check and create insert policies for archive_order_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'archive_order_items' 
    AND policyname = 'Allow public insert access to archive_order_items'
  ) THEN
    CREATE POLICY "Allow public insert access to archive_order_items"
      ON archive_order_items FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;
END $$;

-- Check and create insert policies for archive_customer_notes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'archive_customer_notes' 
    AND policyname = 'Allow public insert access to archive_customer_notes'
  ) THEN
    CREATE POLICY "Allow public insert access to archive_customer_notes"
      ON archive_customer_notes FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;
END $$;
