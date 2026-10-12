CREATE TABLE sinergi.dataset_checkpoints (
  id text PRIMARY KEY,
  dataset_id text NOT NULL REFERENCES sinergi.dataset_state(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 180),
  actor_id text,
  source_revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retained_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  summary jsonb NOT NULL,
  format_version integer NOT NULL,
  checksum text NOT NULL,
  raw_size bigint NOT NULL,
  compressed_size bigint NOT NULL,
  payload bytea NOT NULL,
  UNIQUE(dataset_id,checksum)
);
CREATE INDEX dataset_checkpoints_history ON sinergi.dataset_checkpoints(dataset_id,retained_at DESC);
ALTER TABLE sinergi.dataset_state ADD COLUMN active_import_ids text[] NOT NULL DEFAULT '{}';
UPDATE sinergi.dataset_state d SET active_import_ids=ARRAY(
  SELECT i.id FROM sinergi.imports i WHERE i.dataset_id=d.id AND (i.status='applied' OR i.id=d.latest_import_id
    OR i.id IN (SELECT s.import_id FROM sinergi.source_objects s JOIN sinergi.assets a ON a.source_object_id=s.id WHERE a.dataset_id=d.id)) ORDER BY i.id
);
ALTER TABLE sinergi.dataset_state ADD COLUMN current_checkpoint_id text REFERENCES sinergi.dataset_checkpoints(id) ON DELETE SET NULL;
ALTER TABLE sinergi.import_items DROP CONSTRAINT import_items_matched_asset_id_fkey;
ALTER TABLE sinergi.import_items ADD CONSTRAINT import_items_matched_asset_id_fkey FOREIGN KEY(matched_asset_id) REFERENCES sinergi.assets(id) ON DELETE SET NULL;
