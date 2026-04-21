-- Add apartment & floor to customers for persistence

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS apartment text,
  ADD COLUMN IF NOT EXISTS floor text;

