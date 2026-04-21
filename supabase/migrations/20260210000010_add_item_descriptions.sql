/*
  # Add item descriptions

  - Adds optional description fields (Arabic / English) to items table
*/

ALTER TABLE items
ADD COLUMN IF NOT EXISTS description text DEFAULT '';

ALTER TABLE items
ADD COLUMN IF NOT EXISTS description_en text DEFAULT '';

