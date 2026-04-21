-- Canonical snapshot columns in orders:
-- customer_secondary_phone, customer_landmark
-- Keep historical order customer data immutable on UPDATE.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_secondary_phone text,
  ADD COLUMN IF NOT EXISTS customer_landmark text;

-- Backfill canonical snapshot fields from legacy duplicate columns (if they exist)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'secondary_phone'
  ) THEN
    EXECUTE '
      UPDATE orders
      SET customer_secondary_phone = COALESCE(NULLIF(customer_secondary_phone, ''''), secondary_phone)
      WHERE COALESCE(customer_secondary_phone, '''') = ''''
        AND COALESCE(secondary_phone, '''') <> ''''
    ';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'landmark'
  ) THEN
    EXECUTE '
      UPDATE orders
      SET customer_landmark = COALESCE(NULLIF(customer_landmark, ''''), landmark)
      WHERE COALESCE(customer_landmark, '''') = ''''
        AND COALESCE(landmark, '''') <> ''''
    ';
  END IF;
END
$$;

-- Remove duplicate legacy columns after backfill
ALTER TABLE orders DROP COLUMN IF EXISTS secondary_phone;
ALTER TABLE orders DROP COLUMN IF EXISTS landmark;

CREATE OR REPLACE FUNCTION protect_order_customer_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.customer_name := OLD.customer_name;
  NEW.customer_phone := OLD.customer_phone;
  NEW.customer_secondary_phone := OLD.customer_secondary_phone;
  NEW.customer_street := OLD.customer_street;
  NEW.customer_area := OLD.customer_area;
  NEW.customer_city := OLD.customer_city;
  NEW.customer_apartment := OLD.customer_apartment;
  NEW.customer_floor := OLD.customer_floor;
  NEW.customer_building_number := OLD.customer_building_number;
  NEW.customer_landmark := OLD.customer_landmark;
  NEW.customer_latitude := OLD.customer_latitude;
  NEW.customer_longitude := OLD.customer_longitude;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_order_customer_snapshot ON orders;
CREATE TRIGGER trg_protect_order_customer_snapshot
BEFORE UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION protect_order_customer_snapshot();
