-- Rollback companion for 099_tank_gauging_multi_source.sql

BEGIN;

ALTER TABLE tank_gauging_latest
  DROP COLUMN IF EXISTS source_unit_name;

ALTER TABLE tank_gauging_latest
  DROP COLUMN IF EXISTS source_base_url;

ALTER TABLE tank_gauging_tank_map
  DROP CONSTRAINT IF EXISTS uq_tank_gauging_tank_map_port_source_external;

-- Restore prior uniqueness only if no multi-source collisions remain.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT port_id, external_tank_id, COUNT(*) AS c
      FROM tank_gauging_tank_map
      GROUP BY port_id, external_tank_id
      HAVING COUNT(*) > 1
    ) x
  ) THEN
    ALTER TABLE tank_gauging_tank_map
      ADD CONSTRAINT uq_tank_gauging_tank_map_port_external
      UNIQUE (port_id, external_tank_id);
  END IF;
END $$;

ALTER TABLE tank_gauging_tank_map
  DROP COLUMN IF EXISTS source_unit_name;

ALTER TABLE tank_gauging_tank_map
  DROP COLUMN IF EXISTS source_base_url;

COMMIT;
