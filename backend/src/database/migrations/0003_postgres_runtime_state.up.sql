-- Runtime state required when PostgreSQL is the production source of truth.
-- The original topology_jobs table stored the durable job core; these columns
-- preserve the complete queue contract previously held by JSON job files.

ALTER TABLE topology_jobs
  ADD COLUMN IF NOT EXISTS schema_version text;

UPDATE topology_jobs
SET schema_version = '1.0.0'
WHERE schema_version IS NULL;

ALTER TABLE topology_jobs
  ALTER COLUMN schema_version SET DEFAULT '1.0.0',
  ALTER COLUMN schema_version SET NOT NULL,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

UPDATE topology_jobs
SET queued_at = COALESCE(queued_at, created_at)
WHERE queued_at IS NULL;

ALTER TABLE topology_jobs
  ALTER COLUMN queued_at SET DEFAULT now(),
  ALTER COLUMN queued_at SET NOT NULL;

ALTER TABLE topology_jobs
  ADD CONSTRAINT topology_jobs_progress_ck
    CHECK (progress BETWEEN 0 AND 100),
  ADD CONSTRAINT topology_jobs_revision_ck
    CHECK (revision >= 0);

CREATE INDEX topology_jobs_dataset_status_available_idx
  ON topology_jobs (dataset_version_id, status, available_at);
