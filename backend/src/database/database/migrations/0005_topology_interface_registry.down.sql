DROP INDEX IF EXISTS confirmed_relations_target_interface_idx;
DROP INDEX IF EXISTS topology_candidates_target_interface_idx;
DROP INDEX IF EXISTS topology_interfaces_occupancy_idx;
DROP INDEX IF EXISTS topology_interfaces_owner_idx;
DROP INDEX IF EXISTS topology_components_owner_idx;

DROP TABLE IF EXISTS topology_interfaces;
DROP TABLE IF EXISTS topology_components;

ALTER TABLE confirmed_relations
  DROP COLUMN IF EXISTS mounting_role,
  DROP COLUMN IF EXISTS profile_version,
  DROP COLUMN IF EXISTS traversable,
  DROP COLUMN IF EXISTS cable_role,
  DROP COLUMN IF EXISTS media_type,
  DROP COLUMN IF EXISTS service_domain,
  DROP COLUMN IF EXISTS source_interface_id,
  DROP COLUMN IF EXISTS target_interface_id,
  DROP COLUMN IF EXISTS source_endpoint_id;

ALTER TABLE topology_candidates
  DROP COLUMN IF EXISTS cable_role,
  DROP COLUMN IF EXISTS media_type,
  DROP COLUMN IF EXISTS service_domain,
  DROP COLUMN IF EXISTS source_interface_id,
  DROP COLUMN IF EXISTS target_interface_id;
