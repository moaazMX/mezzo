ALTER TABLE delivery_zones
ADD COLUMN IF NOT EXISTS branch_location jsonb DEFAULT NULL;
