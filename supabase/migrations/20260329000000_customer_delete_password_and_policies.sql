-- Default password for protected customer deletion (changeable in settings UI)
INSERT INTO settings (key, value, updated_at)
VALUES ('customer_delete_password', '2007', now())
ON CONFLICT (key) DO NOTHING;

-- Allow anon/authenticated clients to read this key (OR-combines with any existing restrictive settings policy)
DROP POLICY IF EXISTS "Allow read customer_delete_password setting" ON settings;
CREATE POLICY "Allow read customer_delete_password setting"
  ON settings FOR SELECT
  TO anon, authenticated
  USING (key = 'customer_delete_password');

-- Allow deleting customer rows from operator UI after checks in app
DROP POLICY IF EXISTS "Public can delete customers" ON customers;
CREATE POLICY "Public can delete customers"
  ON customers FOR DELETE
  TO anon, authenticated
  USING (true);
