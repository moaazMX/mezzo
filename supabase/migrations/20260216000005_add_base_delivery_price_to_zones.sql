/*
  # Add base_delivery_price to delivery_zones

  - Represents delivery service price for the main zone area
  - Applies when customer is inside the green zone but outside all yellow layers
*/

ALTER TABLE delivery_zones
  ADD COLUMN IF NOT EXISTS base_delivery_price numeric(10, 2) DEFAULT 0;

