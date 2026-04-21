/*
  # Create delivery zones table

  - Defines rectangular delivery zones using min/max latitude and longitude
  - Used to restrict orders to customers inside configured zones
*/

CREATE TABLE IF NOT EXISTS delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  min_lat double precision NOT NULL,
  max_lat double precision NOT NULL,
  min_lng double precision NOT NULL,
  max_lng double precision NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Allow public (anonymous) read access; writes are only from operator (service role)
ALTER TABLE delivery_zones ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'delivery_zones' 
      AND policyname = 'Allow read access to all'
  ) THEN
    CREATE POLICY "Allow read access to all"
      ON delivery_zones
      FOR SELECT
      USING ( true );
  END IF;
END $$;

