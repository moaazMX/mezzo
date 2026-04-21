-- Password linked to phone for customer app (hashed client-side, stored as hex)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS phone_password_hash text;

COMMENT ON COLUMN customers.phone_password_hash IS 'SHA-256 hex of phone|password|app salt; set after first order; required on checkout if set';
