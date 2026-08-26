-- Multi-ATG source support: scope tank map + latest by source_base_url.

BEGIN;

ALTER TABLE tank_gauging_tank_map
  ADD COLUMN IF NOT EXISTS source_base_url TEXT;

ALTER TABLE tank_gauging_tank_map
  ADD COLUMN IF NOT EXISTS source_unit_name TEXT;

UPDATE tank_gauging_tank_map
SET source_base_url = 'http://172.16.11.77'
WHERE source_base_url IS NULL OR BTRIM(source_base_url) = '';

ALTER TABLE tank_gauging_tank_map
  ALTER COLUMN source_base_url SET NOT NULL;

ALTER TABLE tank_gauging_tank_map
  DROP CONSTRAINT IF EXISTS uq_tank_gauging_tank_map_port_external;

ALTER TABLE tank_gauging_tank_map
  ADD CONSTRAINT uq_tank_gauging_tank_map_port_source_external
  UNIQUE (port_id, source_base_url, external_tank_id);

CREATE INDEX IF NOT EXISTS idx_tank_gauging_tank_map_source
  ON tank_gauging_tank_map (port_id, source_base_url);

COMMENT ON COLUMN tank_gauging_tank_map.source_base_url IS
  'ATG/Tankvision base URL (e.g. http://172.16.11.77) for this external tank id.';

ALTER TABLE tank_gauging_latest
  ADD COLUMN IF NOT EXISTS source_base_url TEXT;

ALTER TABLE tank_gauging_latest
  ADD COLUMN IF NOT EXISTS source_unit_name TEXT;

UPDATE tank_gauging_latest l
SET source_base_url = m.source_base_url,
    source_unit_name = m.source_unit_name
FROM tank_gauging_tank_map m
WHERE m.tank_id = l.tank_id
  AND (l.source_base_url IS NULL OR BTRIM(l.source_base_url) = '');

UPDATE tank_gauging_latest
SET source_base_url = 'http://172.16.11.77'
WHERE source_base_url IS NULL OR BTRIM(source_base_url) = '';

ALTER TABLE tank_gauging_latest
  ALTER COLUMN source_base_url SET NOT NULL;

COMMENT ON COLUMN tank_gauging_latest.source_base_url IS
  'ATG/Tankvision base URL the reading was polled from.';

COMMIT;
