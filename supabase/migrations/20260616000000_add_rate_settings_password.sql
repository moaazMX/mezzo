-- Separate password for changing rate discount settings (login uses rate_page_password)

INSERT INTO settings (key, value)
VALUES ('rate_settings_password', 'moaazMXpl011#')
ON CONFLICT (key) DO NOTHING;
