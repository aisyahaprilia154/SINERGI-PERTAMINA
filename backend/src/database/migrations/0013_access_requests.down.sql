DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM sinergi.app_users WHERE password_hash IS NULL) THEN
    RAISE EXCEPTION 'Google-only accounts exist. Configure local passwords before rollback.';
  END IF;
END $$;
DROP TABLE sinergi.access_requests;
DROP TABLE sinergi.auth_identities;
ALTER TABLE sinergi.app_users DROP COLUMN display_name;
ALTER TABLE sinergi.app_users DROP COLUMN unit_name;
ALTER TABLE sinergi.app_users ALTER COLUMN password_hash SET NOT NULL;
