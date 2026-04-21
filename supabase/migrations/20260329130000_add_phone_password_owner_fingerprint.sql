-- Owner device fingerprint for phone password (stable; not overwritten by normal customer updates)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS phone_password_owner_fingerprint text;

COMMENT ON COLUMN customers.phone_password_owner_fingerprint IS 'Device fingerprint that created/last reset the phone password; used to decide whether to ask password on other devices';

