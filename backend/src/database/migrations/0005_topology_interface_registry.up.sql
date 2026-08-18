ALTER TABLE topology_candidates
  ADD COLUMN IF NOT EXISTS target_interface_id text,
  ADD COLUMN IF NOT EXISTS source_interface_id text,
  ADD COLUMN IF NOT EXISTS service_domain text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS cable_role text;

ALTER TABLE confirmed_relations
  ADD COLUMN IF NOT EXISTS source_endpoint_id text,
  ADD COLUMN IF NOT EXISTS target_interface_id text,
  ADD COLUMN IF NOT EXISTS source_interface_id text,
  ADD COLUMN IF NOT EXISTS service_domain text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS cable_role text,
  ADD COLUMN IF NOT EXISTS traversable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS profile_version text,
  ADD COLUMN IF NOT EXISTS mounting_role text;

CREATE TABLE topology_components (
  dataset_version_id text NOT NULL REFERENCES dataset_versions (id),
  component_id text NOT NULL,
  owner_asset_id text NOT NULL,
  component_type text NOT NULL,
  component_name text,
  profile_id text,
  status text NOT NULL DEFAULT 'active',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_version_id, component_id)
);

CREATE TABLE topology_interfaces (
  dataset_version_id text NOT NULL REFERENCES dataset_versions (id),
  interface_id text NOT NULL,
  owner_asset_id text NOT NULL,
  component_id text NOT NULL,
  interface_type text NOT NULL,
  service_domain text NOT NULL,
  media_type text NOT NULL,
  direction text NOT NULL,
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity > 0),
  occupancy integer NOT NULL DEFAULT 0 CHECK (occupancy >= 0),
  profile_id text,
  assignment_source text,
  source_feature_id text,
  virtual boolean NOT NULL DEFAULT false,
  is_proxy boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_version_id, interface_id),
  CONSTRAINT topology_interfaces_component_fk
    FOREIGN KEY (dataset_version_id, component_id)
    REFERENCES topology_components (dataset_version_id, component_id)
);

CREATE INDEX topology_components_owner_idx
  ON topology_components (dataset_version_id, owner_asset_id, status);

CREATE INDEX topology_interfaces_owner_idx
  ON topology_interfaces (dataset_version_id, owner_asset_id, status);

CREATE INDEX topology_interfaces_occupancy_idx
  ON topology_interfaces (dataset_version_id, service_domain, interface_type, occupancy, capacity);

CREATE INDEX topology_candidates_target_interface_idx
  ON topology_candidates (dataset_version_id, target_interface_id, proposal_status);

CREATE INDEX confirmed_relations_target_interface_idx
  ON confirmed_relations (dataset_version_id, target_interface_id, verification_status);
