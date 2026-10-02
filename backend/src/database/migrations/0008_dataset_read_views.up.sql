-- Keep the map response separately, so a map read never fetches detail/trace
-- metadata. Both views are rebuilt atomically with their aggregate revision.
ALTER TABLE dataset_version_active_reads ADD COLUMN read_view text NOT NULL DEFAULT 'active-read';
ALTER TABLE dataset_version_active_reads DROP CONSTRAINT dataset_version_active_reads_pkey;
ALTER TABLE dataset_version_active_reads ADD PRIMARY KEY (dataset_version_id, read_view);
