DROP INDEX IF EXISTS dataset_version_diffs_query_idx;
DROP TABLE IF EXISTS dataset_version_diffs;
DROP INDEX IF EXISTS asset_identity_registry_asset_idx;
DROP INDEX IF EXISTS asset_identity_registry_active_source_idx;
DROP TABLE IF EXISTS asset_identity_registry;
ALTER TABLE dataset_active_pointers DROP COLUMN IF EXISTS publication_profile;
ALTER TABLE dataset_versions DROP COLUMN IF EXISTS publication_profile;
