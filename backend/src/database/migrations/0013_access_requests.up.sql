ALTER TABLE sinergi.app_users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE sinergi.app_users ADD COLUMN display_name text;
ALTER TABLE sinergi.app_users ADD COLUMN unit_name text;
CREATE TABLE sinergi.auth_identities (
  provider text NOT NULL CHECK(provider='google'),
  subject text NOT NULL,
  user_id text NOT NULL REFERENCES sinergi.app_users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,subject), UNIQUE(provider,user_id)
);
CREATE TABLE sinergi.access_requests (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK(kind IN ('access','password_reset')),
  identifier text NOT NULL,
  full_name text,
  email text,
  unit_name text,
  google_subject text,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  review_note text,
  reviewed_by text,
  resolved_user_id text REFERENCES sinergi.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE UNIQUE INDEX access_requests_pending ON sinergi.access_requests(kind,identifier) WHERE status='pending';
CREATE UNIQUE INDEX access_requests_google_pending ON sinergi.access_requests(google_subject) WHERE status='pending' AND google_subject IS NOT NULL;
CREATE INDEX access_requests_history ON sinergi.access_requests(created_at DESC);
