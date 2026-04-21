-- Add general_note_id to unify customer notes across orders + archive
-- And ensure archive_customer_notes can be updated via RLS

-- =========================================================
-- 1) Add general_note_id columns
-- =========================================================

ALTER TABLE customer_general_notes
  ADD COLUMN IF NOT EXISTS general_note_id uuid;

ALTER TABLE customer_notes
  ADD COLUMN IF NOT EXISTS general_note_id uuid;

ALTER TABLE archive_customer_notes
  ADD COLUMN IF NOT EXISTS general_note_id uuid;

-- Make customer_general_notes.general_note_id mirror its primary key
UPDATE customer_general_notes
SET general_note_id = id
WHERE general_note_id IS NULL;

-- Indexes for faster fan-out updates
CREATE INDEX IF NOT EXISTS idx_customer_general_notes_general_note_id
  ON customer_general_notes(general_note_id);

CREATE INDEX IF NOT EXISTS idx_customer_notes_general_note_id
  ON customer_notes(general_note_id);

CREATE INDEX IF NOT EXISTS idx_archive_customer_notes_general_note_id
  ON archive_customer_notes(general_note_id);

-- =========================================================
-- 2) Best-effort backfill existing notes with matching general notes
-- =========================================================

-- Backfill customer_notes by matching (customer phone+name) + note text
UPDATE customer_notes cn
SET general_note_id = cgn.id
FROM customers c
JOIN customer_general_notes cgn
  ON cgn.customer_phone = c.phone
 AND cgn.customer_name = c.name
WHERE cn.general_note_id IS NULL
  AND cn.customer_id = c.id
  AND cgn.note = cn.note;

-- Backfill archive_customer_notes by matching customer_id + note text via customers -> general notes
UPDATE archive_customer_notes acn
SET general_note_id = cgn.id
FROM customers c
JOIN customer_general_notes cgn
  ON cgn.customer_phone = c.phone
 AND cgn.customer_name = c.name
WHERE acn.general_note_id IS NULL
  AND acn.customer_id = c.id
  AND cgn.note = acn.note;

-- =========================================================
-- 3) RLS policy for archive_customer_notes UPDATE (needed for edit fan-out)
-- =========================================================

ALTER TABLE archive_customer_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public update access to archive_customer_notes" ON archive_customer_notes;
CREATE POLICY "Allow public update access to archive_customer_notes"
  ON archive_customer_notes
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

