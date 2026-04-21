-- Recovery code for phone password reset (hashed client-side, stored as hex)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS phone_recovery_code_hash text;

COMMENT ON COLUMN customers.phone_recovery_code_hash IS 'SHA-256 hex of phone|recovery_code|app salt; used to reset phone password on another device';

