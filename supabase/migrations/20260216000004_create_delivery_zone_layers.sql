/*
  # Create delivery_zone_layers table

  - Represents nested delivery service layers (yellow areas) inside a delivery zone
  - Each layer has its own polygon (usually smaller, inside the parent zone)
  - Each layer has a delivery_price that can be used based on customer's location
*/

CREATE TABLE IF NOT EXISTS delivery_zone_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES delivery_zones(id) ON DELETE CASCADE,
  name text,
  order_index integer NOT NULL DEFAULT 1,
  polygon_points jsonb NOT NULL,
  delivery_price numeric(10, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE delivery_zone_layers ENABLE ROW LEVEL SECURITY;

-- Allow public (anonymous) read access to layers (same as delivery_zones)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'delivery_zone_layers' 
      AND policyname = 'Allow read access to all layers'
  ) THEN
    CREATE POLICY "Allow read access to all layers"
      ON delivery_zone_layers
      FOR SELECT
      USING ( true );
  END IF;
END $$;

-- Allow INSERT for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'delivery_zone_layers' 
      AND policyname = 'Allow insert for authenticated users (layers)'
  ) THEN
    CREATE POLICY "Allow insert for authenticated users (layers)"
      ON delivery_zone_layers
      FOR INSERT
      WITH CHECK ( true );
  END IF;
END $$;

-- Allow UPDATE for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'delivery_zone_layers' 
      AND policyname = 'Allow update for authenticated users (layers)'
  ) THEN
    CREATE POLICY "Allow update for authenticated users (layers)"
      ON delivery_zone_layers
      FOR UPDATE
      USING ( true )
      WITH CHECK ( true );
  END IF;
END $$;

-- Allow DELETE for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'delivery_zone_layers' 
      AND policyname = 'Allow delete for authenticated users (layers)'
  ) THEN
    CREATE POLICY "Allow delete for authenticated users (layers)"
      ON delivery_zone_layers
      FOR DELETE
      USING ( true );
  END IF;
END $$;

