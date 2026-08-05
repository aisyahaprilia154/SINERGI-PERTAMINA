DROP INDEX IF EXISTS topology_jobs_dataset_status_available_idx;

ALTER TABLE topology_jobs
  DROP CONSTRAINT IF EXISTS topology_jobs_progress_ck,
  DROP CONSTRAINT IF EXISTS topology_jobs_revision_ck,
  DROP COLUMN IF EXISTS schema_version,
  DROP COLUMN IF EXISTS queued_at,
  DROP COLUMN IF EXISTS last_started_at,
  DROP COLUMN IF EXISTS failed_at,
  DROP COLUMN IF EXISTS progress,
  DROP COLUMN IF EXISTS stage,
  DROP COLUMN IF EXISTS cancel_requested,
  DROP COLUMN IF EXISTS revision;
