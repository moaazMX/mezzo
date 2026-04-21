-- Unprotected restore function (no token) for simple Slots UX.
-- Requires the caller already has access to call the function.

CREATE OR REPLACE FUNCTION restore_slot_unprotected(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tables jsonb;
BEGIN
  tables := COALESCE(payload->'tables', '{}'::jsonb);

  -- Delete/Truncate in safe order (child tables first)
  TRUNCATE TABLE
    order_items,
    customer_notes,
    orders,
    archive_order_items,
    archive_customer_notes,
    archive_orders,
    device_coupons,
    customer_general_notes,
    customers,
    items,
    categories,
    delivery_zone_layers,
    delivery_zones,
    delivery_services
  RESTART IDENTITY CASCADE;

  -- Re-insert in dependency order
  IF tables ? 'categories' THEN
    INSERT INTO categories
    SELECT * FROM jsonb_populate_recordset(NULL::categories, tables->'categories');
  END IF;

  IF tables ? 'items' THEN
    INSERT INTO items
    SELECT * FROM jsonb_populate_recordset(NULL::items, tables->'items');
  END IF;

  IF tables ? 'customers' THEN
    INSERT INTO customers
    SELECT * FROM jsonb_populate_recordset(NULL::customers, tables->'customers');
  END IF;

  IF tables ? 'customer_general_notes' THEN
    INSERT INTO customer_general_notes
    SELECT * FROM jsonb_populate_recordset(NULL::customer_general_notes, tables->'customer_general_notes');
  END IF;

  IF tables ? 'orders' THEN
    INSERT INTO orders
    SELECT * FROM jsonb_populate_recordset(NULL::orders, tables->'orders');
  END IF;

  IF tables ? 'order_items' THEN
    INSERT INTO order_items
    SELECT * FROM jsonb_populate_recordset(NULL::order_items, tables->'order_items');
  END IF;

  IF tables ? 'customer_notes' THEN
    INSERT INTO customer_notes
    SELECT * FROM jsonb_populate_recordset(NULL::customer_notes, tables->'customer_notes');
  END IF;

  IF tables ? 'archive_orders' THEN
    INSERT INTO archive_orders
    SELECT * FROM jsonb_populate_recordset(NULL::archive_orders, tables->'archive_orders');
  END IF;

  IF tables ? 'archive_order_items' THEN
    INSERT INTO archive_order_items
    SELECT * FROM jsonb_populate_recordset(NULL::archive_order_items, tables->'archive_order_items');
  END IF;

  IF tables ? 'archive_customer_notes' THEN
    INSERT INTO archive_customer_notes
    SELECT * FROM jsonb_populate_recordset(NULL::archive_customer_notes, tables->'archive_customer_notes');
  END IF;

  IF tables ? 'device_coupons' THEN
    INSERT INTO device_coupons
    SELECT * FROM jsonb_populate_recordset(NULL::device_coupons, tables->'device_coupons');
  END IF;

  IF tables ? 'delivery_services' THEN
    INSERT INTO delivery_services
    SELECT * FROM jsonb_populate_recordset(NULL::delivery_services, tables->'delivery_services');
  END IF;

  IF tables ? 'delivery_zones' THEN
    INSERT INTO delivery_zones
    SELECT * FROM jsonb_populate_recordset(NULL::delivery_zones, tables->'delivery_zones');
  END IF;

  IF tables ? 'delivery_zone_layers' THEN
    INSERT INTO delivery_zone_layers
    SELECT * FROM jsonb_populate_recordset(NULL::delivery_zone_layers, tables->'delivery_zone_layers');
  END IF;

  -- Restore settings last
  IF tables ? 'settings' THEN
    TRUNCATE TABLE settings RESTART IDENTITY CASCADE;
    INSERT INTO settings
    SELECT * FROM jsonb_populate_recordset(NULL::settings, tables->'settings');
  END IF;
END;
$$;

