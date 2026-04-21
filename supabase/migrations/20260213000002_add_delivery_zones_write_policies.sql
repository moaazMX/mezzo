/*
  # Add write policies for delivery_zones
  
  - Allows authenticated users (operators) to insert/update/delete zones
  - For now, we'll allow all authenticated users (you can restrict this later based on your auth setup)
*/

-- Allow INSERT for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'delivery_zones' 
      AND policyname = 'Allow insert for authenticated users'
  ) THEN
    CREATE POLICY "Allow insert for authenticated users"
      ON delivery_zones
      FOR INSERT
      WITH CHECK ( true ); -- Allow all inserts for now (you can add auth check later)
  END IF;
END $$;

-- Allow UPDATE for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'delivery_zones' 
      AND policyname = 'Allow update for authenticated users'
  ) THEN
    CREATE POLICY "Allow update for authenticated users"
      ON delivery_zones
      FOR UPDATE
      USING ( true ) -- Allow all updates for now
      WITH CHECK ( true );
  END IF;
END $$;

-- Allow DELETE for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'delivery_zones' 
      AND policyname = 'Allow delete for authenticated users'
  ) THEN
    CREATE POLICY "Allow delete for authenticated users"
      ON delivery_zones
      FOR DELETE
      USING ( true ); -- Allow all deletes for now
  END IF;
END $$;
