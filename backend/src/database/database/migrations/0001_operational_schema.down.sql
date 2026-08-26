-- Keep the PostGIS extension installed: it may be shared by other schemas.
-- This rollback removes only objects owned by 0001_operational_schema.

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
DROP FUNCTION IF EXISTS prevent_audit_event_mutation();

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS accuracy_evaluations;
DROP TABLE IF EXISTS graph_edges;
DROP TABLE IF EXISTS graph_nodes;
DROP TABLE IF EXISTS graph_revisions;
DROP TABLE IF EXISTS confirmed_relations;
DROP TABLE IF EXISTS topology_candidates;
DROP TABLE IF EXISTS topology_jobs;
DROP TABLE IF EXISTS classified_objects;
DROP TABLE IF EXISTS source_geometries;
DROP TABLE IF EXISTS source_features;
DROP TABLE IF EXISTS dataset_versions;
