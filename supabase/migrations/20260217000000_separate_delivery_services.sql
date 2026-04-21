/*
  # Separate delivery services from delivery zones

  - Creates delivery_services table with independent branch location
  - Adds service_id to delivery_zone_layers so layers can belong to a delivery service
  - Makes zone_id nullable on delivery_zone_layers
  - Adds a check constraint requiring either zone_id or service_id to be present
*/

-- Create delivery_services table
CREATE TABLE IF NOT EXISTS delivery_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- Branch pin location for this service (center point of service area)
  branch_location jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE delivery_services ENABLE ROW LEVEL SECURITY;

-- Allow public (anonymous) read access to delivery services
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'delivery_services' 
      AND policyname = 'Allow read access to all delivery services'
  ) THEN
    CREATE POLICY "Allow read access to all delivery services"
      ON delivery_services
      FOR SELECT
      USING ( true );
  END IF;
END $$;

-- Allow INSERT for authenticated users (operators / service role)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'delivery_services' 
      AND policyname = 'Allow insert for authenticated users (delivery services)'
  ) THEN
    CREATE POLICY "Allow insert for authenticated users (delivery services)"
      ON delivery_services
      FOR INSERT
      WITH CHECK ( true );
  END IF;
END $$;

-- Allow UPDATE for authenticated users (operators / service role)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'delivery_services' 
      AND policyname = 'Allow update for authenticated users (delivery services)'
  ) THEN
    CREATE POLICY "Allow update for authenticated users (delivery services)"
      ON delivery_services
      FOR UPDATE
      USING ( true )
      WITH CHECK ( true );
  END IF;
END $$;

-- Allow DELETE for authenticated users (operators / service role)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'delivery_services' 
      AND policyname = 'Allow delete for authenticated users (delivery services)'
  ) THEN
    CREATE POLICY "Allow delete for authenticated users (delivery services)"
      ON delivery_services
      FOR DELETE
      USING ( true );
  END IF;
END $$;

-- Add service_id to delivery_zone_layers so a layer can belong to a delivery service
ALTER TABLE delivery_zone_layers
  ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES delivery_services(id) ON DELETE CASCADE;

-- Make zone_id nullable to allow service-only layers
ALTER TABLE delivery_zone_layers
  ALTER COLUMN zone_id DROP NOT NULL;

-- Ensure that at least one of zone_id or service_id is present on each row
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'delivery_zone_layers_zone_or_service_required'
      AND conrelid = 'delivery_zone_layers'::regclass
  ) THEN
    ALTER TABLE delivery_zone_layers
      ADD CONSTRAINT delivery_zone_layers_zone_or_service_required
      CHECK (
        zone_id IS NOT NULL
        OR service_id IS NOT NULL
      );
  END IF;
END $$;

