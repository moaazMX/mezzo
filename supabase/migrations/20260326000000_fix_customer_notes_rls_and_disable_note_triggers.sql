-- Fix customer_notes editing:
-- 1) Add missing RLS policies for UPDATE/DELETE on customer_notes.
-- 2) Disable redundant triggers that sync customer_notes -> customer_general_notes.

-- =========================================================
-- 1) Policies for customer_notes UPDATE/DELETE
-- =========================================================

ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can update customer notes" ON customer_notes;
CREATE POLICY "Public can update customer notes"
  ON customer_notes
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public can delete customer notes" ON customer_notes;
CREATE POLICY "Public can delete customer notes"
  ON customer_notes
  FOR DELETE
  TO anon, authenticated
  USING (true);

-- =========================================================
-- 2) Disable triggers that sync to customer_general_notes
-- =========================================================

DROP TRIGGER IF EXISTS tr_update_general_note ON customer_notes;
DROP TRIGGER IF EXISTS tr_delete_general_note ON customer_notes;

DROP FUNCTION IF EXISTS update_general_note_from_order_note();
DROP FUNCTION IF EXISTS delete_general_note_from_order_note();

