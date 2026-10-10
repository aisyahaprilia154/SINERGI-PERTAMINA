CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS sinergi;
CREATE OR REPLACE FUNCTION sinergi.prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_events is append-only'; END;
$$;

CREATE TABLE sinergi.imports (
  id text PRIMARY KEY, dataset_id text NOT NULL, name text NOT NULL,
  source_filename text, source_storage_key text, source_checksum text, source_size bigint,
  status text NOT NULL CHECK (status IN ('processing','ready','applied','failed','archived')),
  base_revision bigint NOT NULL DEFAULT 0, actor_id text,
  summary jsonb NOT NULL DEFAULT '{}', source_manifest jsonb NOT NULL DEFAULT '{}',
  error jsonb, created_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz
);
CREATE INDEX imports_history ON sinergi.imports (dataset_id, created_at DESC);
CREATE INDEX imports_checksum ON sinergi.imports (dataset_id, source_checksum);

CREATE TABLE sinergi.dataset_state (
  id text PRIMARY KEY, revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  latest_import_id text REFERENCES sinergi.imports(id),
  diagram_layout jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sinergi.facilities (
  id text PRIMARY KEY, dataset_id text NOT NULL REFERENCES sinergi.dataset_state(id),
  name text NOT NULL, aliases text[] NOT NULL DEFAULT '{}', UNIQUE(dataset_id,name)
);
CREATE TABLE sinergi.asset_categories (
  id text PRIMARY KEY, name text NOT NULL UNIQUE,
  diagram_role text NOT NULL DEFAULT 'endpoint'
    CHECK (diagram_role IN ('rack-root','junction-peer','junction-extended','physical-mount','endpoint','path','area')),
  default_icon text
);
CREATE TABLE sinergi.source_objects (
  id text PRIMARY KEY, import_id text REFERENCES sinergi.imports(id),
  source_feature_id text NOT NULL, source_key text, document_path text, folder_path text,
  name text, kml_id text, fingerprint text, geometry geometry,
  parts jsonb NOT NULL DEFAULT '[]', properties jsonb NOT NULL DEFAULT '{}',
  CHECK (geometry IS NULL OR ST_SRID(geometry)=4326)
);
CREATE INDEX source_objects_geometry ON sinergi.source_objects USING gist(geometry);
CREATE TABLE sinergi.assets (
  id text PRIMARY KEY, dataset_id text NOT NULL REFERENCES sinergi.dataset_state(id),
  facility_id text REFERENCES sinergi.facilities(id), category_id text NOT NULL REFERENCES sinergi.asset_categories(id),
  source_object_id text REFERENCES sinergi.source_objects(id), name text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('device','path','area','annotation')),
  coordinate_override geometry, custom_icon jsonb,
  properties jsonb NOT NULL DEFAULT '{}', deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coordinate_override IS NULL OR ST_SRID(coordinate_override)=4326)
);
CREATE INDEX assets_facility ON sinergi.assets(dataset_id,facility_id) WHERE NOT deleted;
CREATE TABLE sinergi.asset_aliases (
  id text PRIMARY KEY, asset_id text NOT NULL REFERENCES sinergi.assets(id),
  namespace text NOT NULL, facility_id text REFERENCES sinergi.facilities(id),
  match_type text NOT NULL, match_value text NOT NULL, active boolean NOT NULL DEFAULT true,
  UNIQUE(asset_id,namespace,match_type,match_value)
);
CREATE INDEX asset_aliases_lookup ON sinergi.asset_aliases(namespace,match_type,match_value) WHERE active;
CREATE TABLE sinergi.relations (
  id text PRIMARY KEY, dataset_id text NOT NULL REFERENCES sinergi.dataset_state(id),
  source_asset_id text NOT NULL REFERENCES sinergi.assets(id),
  target_asset_id text NOT NULL REFERENCES sinergi.assets(id),
  kind text NOT NULL CHECK(kind IN ('connection','mounting')),
  path_asset_id text REFERENCES sinergi.assets(id),
  provenance text NOT NULL DEFAULT 'automatic', protected boolean NOT NULL DEFAULT false,
  deleted boolean NOT NULL DEFAULT false, source_refs jsonb NOT NULL DEFAULT '[]',
  properties jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_asset_id <> target_asset_id)
);
CREATE INDEX relations_dataset ON sinergi.relations(dataset_id) WHERE NOT deleted;
CREATE UNIQUE INDEX relations_one_mount ON sinergi.relations(source_asset_id) WHERE kind='mounting' AND NOT deleted;
CREATE TABLE sinergi.import_items (
  id text PRIMARY KEY, import_id text NOT NULL REFERENCES sinergi.imports(id),
  kind text NOT NULL CHECK(kind IN ('asset','relation','source')),
  status text NOT NULL CHECK(status IN ('new','existing','conflict','invalid','skipped','applied')),
  matched_asset_id text REFERENCES sinergi.assets(id), decision text,
  reason text, proposal jsonb NOT NULL DEFAULT '{}', result jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX import_items_preview ON sinergi.import_items(import_id,status);
CREATE TABLE sinergi.jobs (
  id text PRIMARY KEY, import_id text REFERENCES sinergi.imports(id),
  status text NOT NULL CHECK(status IN ('queued','running','retry_wait','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 3,
  available_at timestamptz NOT NULL DEFAULT now(), locked_by text, lock_expires_at timestamptz,
  progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  error jsonb, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE(import_id)
);
CREATE INDEX jobs_claim ON sinergi.jobs(available_at) WHERE status IN ('queued','running','retry_wait');
CREATE TABLE sinergi.app_users (
  id text PRIMARY KEY, username text NOT NULL UNIQUE CHECK(username=lower(username)), email text,
  password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('Administrator','Viewer')),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email ON sinergi.app_users(lower(email)) WHERE email IS NOT NULL;
CREATE TABLE sinergi.audit_events (
  id text PRIMARY KEY, event text NOT NULL, actor_id text, dataset_id text,
  import_id text REFERENCES sinergi.imports(id), occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_history ON sinergi.audit_events(dataset_id,occurred_at DESC);
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON sinergi.audit_events
  FOR EACH ROW EXECUTE FUNCTION sinergi.prevent_audit_mutation();
