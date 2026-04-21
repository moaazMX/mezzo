/*
  # Coupon disable flag

  - Adds is_disabled flag to device_coupons for operator control
*/

ALTER TABLE device_coupons
ADD COLUMN IF NOT EXISTS is_disabled boolean DEFAULT false;

