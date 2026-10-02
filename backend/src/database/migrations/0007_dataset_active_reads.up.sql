-- Disposable operational projections, revision-checked against their source.
-- Normal aggregate writes populate these within the same transaction. Existing
-- versions are materialized once on first use rather than blocking migration.
CREATE TABLE dataset_version_active_reads (
  dataset_version_id text PRIMARY KEY REFERENCES dataset_versions(id) ON DELETE CASCADE,
  storage_revision text NOT NULL,
  projection_version text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
