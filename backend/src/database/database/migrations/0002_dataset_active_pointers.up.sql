-- Publication boundary for the PostgreSQL repository adapter.

CREATE TABLE dataset_active_pointers (
  dataset_id text NOT NULL,
  branch_id text NOT NULL,
  dataset_version_id text NOT NULL,
  previous_dataset_version_id text,
  revision text NOT NULL,
  activated_by text,
  activated_at timestamptz NOT NULL,
  migrated_from_legacy_status boolean NOT NULL DEFAULT false,
  PRIMARY KEY (dataset_id, branch_id),
  UNIQUE (dataset_version_id),
  CONSTRAINT dataset_active_pointers_target_fk
    FOREIGN KEY (dataset_version_id) REFERENCES dataset_versions (id),
  CONSTRAINT dataset_active_pointers_previous_fk
    FOREIGN KEY (previous_dataset_version_id) REFERENCES dataset_versions (id)
);

CREATE UNIQUE INDEX dataset_versions_one_active_idx
  ON dataset_versions (dataset_id, branch_id)
  WHERE status = 'active';

CREATE INDEX dataset_active_pointers_version_idx
  ON dataset_active_pointers (dataset_version_id);
