ALTER TABLE customer_notes
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;

ALTER TABLE archive_customer_notes
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;

ALTER TABLE customer_general_notes
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;
