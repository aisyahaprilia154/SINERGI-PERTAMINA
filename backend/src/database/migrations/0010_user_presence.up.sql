ALTER TABLE sinergi.app_users ADD COLUMN last_seen_at timestamptz;
ALTER TABLE sinergi.app_users ADD COLUMN auth_version bigint NOT NULL DEFAULT 0 CHECK(auth_version >= 0);
