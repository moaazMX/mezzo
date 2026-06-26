-- Allow rate page batch updates to order_items.rate_discount_percent

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'order_items'
      AND policyname = 'Allow public update access to order_items'
  ) THEN
    CREATE POLICY "Allow public update access to order_items"
      ON order_items FOR UPDATE
      TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'archive_order_items'
      AND policyname = 'Allow public update access to archive_order_items'
  ) THEN
    CREATE POLICY "Allow public update access to archive_order_items"
      ON archive_order_items FOR UPDATE
      TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
