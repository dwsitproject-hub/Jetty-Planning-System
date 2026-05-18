-- Multi-line loading progress per cargo_operations activity (child rows).

BEGIN;

CREATE TABLE IF NOT EXISTS operation_cargo_load_lines (
  id BIGSERIAL PRIMARY KEY,
  operational_activity_id BIGINT NOT NULL
    REFERENCES operation_operational_activities(id) ON DELETE CASCADE,
  line_order INT NOT NULL,
  qty NUMERIC(20, 6) NOT NULL CHECK (qty > 0),
  as_of_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (operational_activity_id, line_order)
);

CREATE INDEX IF NOT EXISTS idx_operation_cargo_load_lines_activity
  ON operation_cargo_load_lines (operational_activity_id);

COMMENT ON TABLE operation_cargo_load_lines IS
  'Per-line qty + as-of time for cargo_operations activities (incremental loading rate).';

-- One synthetic line per legacy row that only had cargo_moved_qty.
INSERT INTO operation_cargo_load_lines (operational_activity_id, line_order, qty, as_of_at)
SELECT id,
       1,
       cargo_moved_qty,
       COALESCE(end_at, start_at)
FROM operation_operational_activities
WHERE milestone_key = 'cargo_operations'
  AND entry_type = 'activity'
  AND deleted_at IS NULL
  AND cargo_moved_qty IS NOT NULL
  AND cargo_moved_qty > 0;

UPDATE operation_operational_activities oa
SET cargo_moved_qty = NULL,
    updated_at = NOW()
WHERE oa.id IN (SELECT operational_activity_id FROM operation_cargo_load_lines)
  AND oa.milestone_key = 'cargo_operations'
  AND oa.entry_type = 'activity'
  AND oa.deleted_at IS NULL;

COMMIT;
