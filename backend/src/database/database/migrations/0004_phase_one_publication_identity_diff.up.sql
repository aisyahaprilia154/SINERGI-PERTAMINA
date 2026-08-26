-- Fase 1 publication contract, stable identity registry, and explainable diff.

ALTER TABLE dataset_versions
  ADD COLUMN IF NOT EXISTS publication_profile text
    CHECK (publication_profile IN ('map_only', 'operational_topology'));

ALTER TABLE dataset_active_pointers
  ADD COLUMN IF NOT EXISTS publication_profile text
    CHECK (publication_profile IN ('map_only', 'operational_topology'));

CREATE TABLE asset_identity_registry (
  registry_id text PRIMARY KEY,
  dataset_id text NOT NULL,
  branch_id text NOT NULL,
  asset_id text NOT NULL,
  source_match_type text NOT NULL
    CHECK (source_match_type IN ('source_kml_id', 'source_feature_id', 'source_feature_key')),
  source_match_value text NOT NULL,
  valid_from_dataset_version_id text NOT NULL,
  valid_to_dataset_version_id text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'rejected')),
  approved_by text,
  approved_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_identity_registry_from_fk
    FOREIGN KEY (valid_from_dataset_version_id) REFERENCES dataset_versions (id)
      ON DELETE CASCADE,
  CONSTRAINT asset_identity_registry_to_fk
    FOREIGN KEY (valid_to_dataset_version_id) REFERENCES dataset_versions (id)
      ON DELETE CASCADE
  -- audit_event_id is retained as an application-level link. It may be
  -- generated before the aggregate transaction commits.
);

CREATE UNIQUE INDEX asset_identity_registry_active_source_idx
  ON asset_identity_registry (
    dataset_id, branch_id, source_match_type, source_match_value
  ) WHERE status = 'active';

CREATE INDEX asset_identity_registry_asset_idx
  ON asset_identity_registry (dataset_id, branch_id, asset_id, status);

CREATE TABLE dataset_version_diffs (
  candidate_dataset_version_id text NOT NULL,
  base_dataset_version_id text,
  comparison_revision text NOT NULL,
  change_id text NOT NULL,
  change_type text NOT NULL,
  risk text NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  asset_id text,
  before_ref jsonb,
  after_ref jsonb,
  changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_dataset_version_id, change_id),
  CONSTRAINT dataset_version_diffs_candidate_fk
    FOREIGN KEY (candidate_dataset_version_id) REFERENCES dataset_versions (id)
      ON DELETE CASCADE,
  CONSTRAINT dataset_version_diffs_base_fk
    FOREIGN KEY (base_dataset_version_id) REFERENCES dataset_versions (id)
      ON DELETE CASCADE
);

CREATE INDEX dataset_version_diffs_query_idx
  ON dataset_version_diffs (
    candidate_dataset_version_id, comparison_revision, risk, change_type, change_id
  );
