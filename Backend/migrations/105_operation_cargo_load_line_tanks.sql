-- Per load-segment shore tank selections for liquid cargo operations.

BEGIN;

CREATE TABLE IF NOT EXISTS operation_cargo_load_line_tanks (
  load_line_id BIGINT NOT NULL
    REFERENCES operation_cargo_load_lines(id) ON DELETE CASCADE,
  tank_id BIGINT NOT NULL
    REFERENCES master_tanks(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (load_line_id, tank_id)
);

CREATE INDEX IF NOT EXISTS idx_operation_cargo_load_line_tanks_tank
  ON operation_cargo_load_line_tanks (tank_id);

COMMENT ON TABLE operation_cargo_load_line_tanks IS
  'Shore tanks selected on each cargo load segment (multi-select; liquid only).';

-- Backfill from activity-level selections so existing records keep working.
INSERT INTO operation_cargo_load_line_tanks (load_line_id, tank_id)
SELECT l.id, cat.tank_id
FROM operation_cargo_load_lines l
JOIN operation_cargo_activity_tanks cat
  ON cat.operational_activity_id = l.operational_activity_id
ON CONFLICT DO NOTHING;

COMMIT;
