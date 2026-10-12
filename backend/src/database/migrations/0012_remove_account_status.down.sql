-- All accounts were permitted to log in after this migration.
ALTER TABLE sinergi.app_users ADD COLUMN active boolean NOT NULL DEFAULT true;
