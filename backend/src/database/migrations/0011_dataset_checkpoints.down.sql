ALTER TABLE sinergi.import_items DROP CONSTRAINT import_items_matched_asset_id_fkey;
ALTER TABLE sinergi.import_items ADD CONSTRAINT import_items_matched_asset_id_fkey FOREIGN KEY(matched_asset_id) REFERENCES sinergi.assets(id);
ALTER TABLE sinergi.dataset_state DROP COLUMN current_checkpoint_id;
ALTER TABLE sinergi.dataset_state DROP COLUMN active_import_ids;
DROP TABLE sinergi.dataset_checkpoints;
