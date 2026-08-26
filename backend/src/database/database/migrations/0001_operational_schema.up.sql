-- PostgreSQL/PostGIS operational schema foundation.
-- The source KML/KMZ bytes remain immutable file/object storage. JSONB payloads
-- retain the exact application contract while indexed columns are introduced
-- for query, review, job, and graph operations.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE dataset_versions (
  id text PRIMARY KEY,
  dataset_id text NOT NULL,
  branch_id text NOT NULL,
  version_name text NOT NULL,
  source_filename text,
  source_storage_key text,
  source_size bigint CHECK (source_size IS NULL OR source_size >= 0),
  source_checksum text,
  contract_version text NOT NULL DEFAULT '1.0.0',
  validation_status text NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'valid', 'invalid')),
  publication_status text NOT NULL DEFAULT 'unpublished'
    CHECK (publication_status IN ('unpublished', 'published', 'archived')),
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('draft', 'processing', 'valid', 'invalid', 'active', 'archived')),
  active_pointer_revision text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_features (
  dataset_version_id text NOT NULL
    REFERENCES dataset_versions (id),
  source_feature_id text NOT NULL,
  source_feature_key text,
  source_element_type text NOT NULL,
  source_folder_path text,
  source_name text,
  source_kml_id text,
  visibility boolean NOT NULL DEFAULT true,
  source_fingerprint text,
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(raw_properties) = 'object'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (dataset_version_id, source_feature_id)
);

CREATE TABLE source_geometries (
  dataset_version_id text NOT NULL
    REFERENCES dataset_versions (id),
  source_geometry_id text NOT NULL,
  source_feature_id text NOT NULL,
  geometry_part_identity text,
  geometry_type text NOT NULL,
  geometry geometry(Geometry, 4326),
  coordinates jsonb,
  source_coordinate_text jsonb,
  source_vertex_order_preserved boolean NOT NULL DEFAULT true,
  valid boolean NOT NULL DEFAULT true,
  geometry_fingerprint text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (dataset_version_id, source_geometry_id),
  CONSTRAINT source_geometries_feature_fk
    FOREIGN KEY (dataset_version_id, source_feature_id)
    REFERENCES source_features (dataset_version_id, source_feature_id)
);

CREATE TABLE classified_objects (
  dataset_version_id text NOT NULL
    REFERENCES dataset_versions (id),
  classified_object_id text NOT NULL,
  source_feature_id text,
  asset_id text,
  canonical_asset_id text,
  stable_asset_id text,
  site_id text NOT NULL,
  object_role text NOT NULL,
  network_family text NOT NULL,
  asset_type text,
  category text,
  classification_status text NOT NULL,
  classification_score numeric(8, 6)
    CHECK (classification_score IS NULL OR classification_score BETWEEN 0 AND 1),
  classification_evidence jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(classification_evidence) = 'array'),
  geometry_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(geometry_ids) = 'array'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (dataset_version_id, classified_object_id),
  UNIQUE (dataset_version_id, canonical_asset_id),
  CONSTRAINT classified_objects_feature_fk
    FOREIGN KEY (dataset_version_id, source_feature_id)
    REFERENCES source_features (dataset_version_id, source_feature_id)
);

CREATE TABLE topology_jobs (
  job_id text PRIMARY KEY,
  job_type text NOT NULL
    CHECK (job_type IN (
      'parse_source',
      'classify_objects',
      'generate_candidates',
      'rebuild_graph_component',
      'regenerate_full_topology',
      'evaluate_accuracy',
      'publish_dataset'
    )),
  dataset_version_id text,
  input_fingerprint text NOT NULL,
  rule_set_version text,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry_wait', 'succeeded', 'failed', 'dead_letter', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  lock_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_summary text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  result jsonb
    CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT topology_jobs_dataset_fk
    FOREIGN KEY (dataset_version_id) REFERENCES dataset_versions (id)
);

CREATE TABLE topology_candidates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_version_id text NOT NULL
    REFERENCES dataset_versions (id),
  candidate_id text NOT NULL,
  candidate_type text NOT NULL,
  source_endpoint_id text,
  source_geometry_id text,
  source_path_asset_id text,
  target_asset_id text,
  target_endpoint_id text,
  target_path_asset_id text,
  site_id text,
  network_family text,
  candidate_status text NOT NULL
    CHECK (candidate_status IN ('candidate', 'ambiguous', 'confirmed', 'rejected', 'revoked')),
  proposal_status text NOT NULL,
  score numeric(8, 6) CHECK (score IS NULL OR score BETWEEN 0 AND 1),
  score_margin numeric(8, 6)
    CHECK (score_margin IS NULL OR score_margin BETWEEN 0 AND 1),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(evidence) = 'array'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_version_id, candidate_id)
);

CREATE TABLE confirmed_relations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_version_id text NOT NULL
    REFERENCES dataset_versions (id),
  relation_id text NOT NULL,
  candidate_id text,
  source_asset_id text NOT NULL,
  target_asset_id text NOT NULL,
  relation_type text NOT NULL,
  relation_kind text,
  direction text NOT NULL DEFAULT 'undirected',
  provenance text NOT NULL,
  verification_status text NOT NULL
    CHECK (verification_status IN ('confirmed', 'revoked')),
  verified_by text,
  verified_at timestamptz,
  audit_event_id text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(evidence) = 'array'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_version_id, relation_id),
  CONSTRAINT confirmed_relations_candidate_fk
    FOREIGN KEY (dataset_version_id, candidate_id)
    REFERENCES topology_candidates (dataset_version_id, candidate_id)
);

CREATE TABLE graph_revisions (
  graph_revision_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_version_id text NOT NULL
    REFERENCES dataset_versions (id),
  revision text NOT NULL,
  parent_revision text,
  status text NOT NULL
    CHECK (status IN ('building', 'validated', 'active', 'superseded', 'failed', 'rolled_back')),
  validation jsonb
    CHECK (validation IS NULL OR jsonb_typeof(validation) = 'object'),
  node_count integer NOT NULL DEFAULT 0 CHECK (node_count >= 0),
  edge_count integer NOT NULL DEFAULT 0 CHECK (edge_count >= 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  published_at timestamptz,
  UNIQUE (dataset_version_id, revision),
  UNIQUE (graph_revision_id, dataset_version_id)
);

CREATE TABLE graph_nodes (
  graph_revision_id bigint NOT NULL,
  dataset_version_id text NOT NULL,
  node_id text NOT NULL,
  asset_id text,
  site_id text,
  network_family text,
  source_geometry_id text,
  location geometry(Point, 4326),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (graph_revision_id, node_id),
  CONSTRAINT graph_nodes_revision_fk
    FOREIGN KEY (graph_revision_id, dataset_version_id)
    REFERENCES graph_revisions (graph_revision_id, dataset_version_id)
);

CREATE TABLE graph_edges (
  graph_revision_id bigint NOT NULL,
  dataset_version_id text NOT NULL,
  edge_id text NOT NULL,
  relation_id text,
  source_node_id text NOT NULL,
  target_node_id text NOT NULL,
  verification_status text NOT NULL DEFAULT 'confirmed'
    CHECK (verification_status = 'confirmed'),
  source_geometry_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(source_geometry_ids) = 'array'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (graph_revision_id, edge_id),
  CONSTRAINT graph_edges_revision_fk
    FOREIGN KEY (graph_revision_id, dataset_version_id)
    REFERENCES graph_revisions (graph_revision_id, dataset_version_id),
  CONSTRAINT graph_edges_relation_fk
    FOREIGN KEY (dataset_version_id, relation_id)
    REFERENCES confirmed_relations (dataset_version_id, relation_id)
);

CREATE TABLE accuracy_evaluations (
  evaluation_id text PRIMARY KEY,
  dataset_version_id text REFERENCES dataset_versions (id),
  site_id text,
  network_family text,
  gold_set_version text NOT NULL,
  gold_set_checksum text NOT NULL,
  rule_set_version text NOT NULL,
  engine_build_sha text NOT NULL,
  sample_size integer NOT NULL CHECK (sample_size >= 0),
  held_out_precision numeric(8, 6) CHECK (held_out_precision BETWEEN 0 AND 1),
  held_out_recall numeric(8, 6) CHECK (held_out_recall BETWEEN 0 AND 1),
  path_accuracy numeric(8, 6) CHECK (path_accuracy BETWEEN 0 AND 1),
  component_accuracy numeric(8, 6) CHECK (component_accuracy BETWEEN 0 AND 1),
  false_component_merge_count integer NOT NULL DEFAULT 0
    CHECK (false_component_merge_count >= 0),
  evaluated_at timestamptz NOT NULL,
  approved_by text,
  approved_at timestamptz,
  status text NOT NULL
    CHECK (status IN ('draft', 'approved', 'rejected', 'expired', 'superseded')),
  expires_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE audit_events (
  event_id text PRIMARY KEY,
  event text NOT NULL,
  actor_id text,
  dataset_version_id text REFERENCES dataset_versions (id),
  branch_id text,
  outcome text NOT NULL,
  correlation_id text,
  occurred_at timestamptz NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX source_features_dataset_name_idx
  ON source_features (dataset_version_id, source_name);

CREATE INDEX source_geometries_dataset_feature_idx
  ON source_geometries (dataset_version_id, source_feature_id);

CREATE INDEX source_geometries_geometry_gist_idx
  ON source_geometries USING GIST (geometry)
  WHERE geometry IS NOT NULL;

CREATE INDEX classified_objects_dataset_site_family_idx
  ON classified_objects (dataset_version_id, site_id, network_family, object_role);

CREATE INDEX topology_jobs_status_available_idx
  ON topology_jobs (status, available_at);

CREATE INDEX topology_candidates_review_idx
  ON topology_candidates (
    dataset_version_id,
    candidate_status,
    site_id,
    network_family,
    score DESC,
    candidate_id ASC
  );

CREATE INDEX topology_candidates_source_endpoint_idx
  ON topology_candidates (dataset_version_id, source_endpoint_id);

CREATE INDEX confirmed_relations_dataset_status_idx
  ON confirmed_relations (dataset_version_id, verification_status);

CREATE INDEX graph_revisions_dataset_status_idx
  ON graph_revisions (dataset_version_id, status, created_at DESC);

CREATE UNIQUE INDEX graph_revisions_one_active_idx
  ON graph_revisions (dataset_version_id)
  WHERE status = 'active';

CREATE INDEX graph_nodes_asset_idx
  ON graph_nodes (dataset_version_id, asset_id);

CREATE INDEX graph_nodes_location_gist_idx
  ON graph_nodes USING GIST (location)
  WHERE location IS NOT NULL;

CREATE INDEX graph_edges_relation_idx
  ON graph_edges (dataset_version_id, relation_id);

CREATE INDEX accuracy_evaluations_gate_idx
  ON accuracy_evaluations (
    status,
    rule_set_version,
    gold_set_checksum,
    site_id,
    network_family,
    expires_at
  );

CREATE INDEX audit_events_dataset_occurred_idx
  ON audit_events (dataset_version_id, occurred_at);

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
