DELETE FROM dataset_version_active_reads WHERE read_view <> 'active-read';
ALTER TABLE dataset_version_active_reads DROP CONSTRAINT dataset_version_active_reads_pkey;
ALTER TABLE dataset_version_active_reads DROP COLUMN read_view;
ALTER TABLE dataset_version_active_reads ADD PRIMARY KEY (dataset_version_id);
