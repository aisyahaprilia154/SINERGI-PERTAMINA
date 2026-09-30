CREATE TABLE app_users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  email text,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('Administrator', 'Viewer')),
  branch_ids text[] NOT NULL DEFAULT '{}',
  dataset_ids text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_users_username_normalized CHECK (username = lower(username))
);

CREATE UNIQUE INDEX app_users_email_lower_idx ON app_users (lower(email)) WHERE email IS NOT NULL;
