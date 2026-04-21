-- Slots restore backend:
-- - Stores restore token as SHA256 hash in settings
-- - Provides RPC to set token (requires admin_password)
-- - Provides RPC to restore all tables from a JSON payload (requires token)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Helper: read a setting value
CREATE OR REPLACE FUNCTION get_setting_value(p_key text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT value FROM settings WHERE key = p_key LIMIT 1
$$;

-- Set (or rotate) restore token. Protected by admin_password.
CREATE OR REPLACE FUNCTION set_operator_restore_token(p_token text, p_admin_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored_admin text;
  token_hash text;
BEGIN
  SELECT value INTO stored_admin FROM settings WHERE key = 'admin_password' LIMIT 1;
  IF stored_admin IS NULL OR stored_admin <> p_admin_password THEN
    RAISE EXCEPTION 'admin_password_invalid';
  END IF;

  token_hash := encode(digest(p_token, 'sha256'), 'hex');

  -- Upsert into settings
  INSERT INTO settings(key, value)
  VALUES ('operator_restore_token_sha256', token_hash)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();
END;
$$;

-- Restore DB from payload JSON.
-- Expected payload structure: { \"tables\": { \"categories\": [...], \"items\": [...], ... } }
CREATE OR REPLACE FUNCTION restore_slot(payload jsonb, p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored_hash text;
  token_hash text;
  tables jsonb;
BEGIN
  stored_hash := get_setting_value('operator_restore_token_sha256');
  IF stored_hash IS NULL THEN
    RAISE EXCEPTION 'restore_token_not_set';
  END IF;

  token_hash := encode(digest(p_token, 'sha256'), 'hex');
  IF token_hash <> stored_hash THEN
    RAISE EXCEPTION 'restore_token_invalid';
  END IF;

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

  -- Restore settings last (it may include admin_password, token hash, etc.)
  IF tables ? 'settings' THEN
    TRUNCATE TABLE settings RESTART IDENTITY CASCADE;
    INSERT INTO settings
    SELECT * FROM jsonb_populate_recordset(NULL::settings, tables->'settings');
  END IF;
END;
$$;

