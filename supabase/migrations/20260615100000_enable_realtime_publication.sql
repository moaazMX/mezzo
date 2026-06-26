-- Enable Supabase Realtime (postgres_changes) for core app tables.
-- Safe to re-run: skips tables already in supabase_realtime publication.

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'orders',
    'order_items',
    'customer_notes',
    'archive_orders',
    'archive_order_items',
    'archive_customer_notes',
    'categories',
    'items',
    'device_coupons',
    'settings',
    'customers',
    'customer_general_notes',
    'customer_saved_addresses',
    'delivery_zones',
    'delivery_services',
    'delivery_zone_layers'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;
