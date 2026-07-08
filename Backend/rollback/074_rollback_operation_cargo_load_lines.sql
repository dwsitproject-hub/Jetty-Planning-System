-- Rollback 074: restore cargo_moved_qty from first line where possible; drop child table.

BEGIN;

UPDATE operation_operational_activities oa
SET cargo_moved_qty = sub.qty,
    updated_at = NOW()
FROM (
  SELECT DISTINCT ON (operational_activity_id)
    operational_activity_id,
    qty
  FROM operation_cargo_load_lines
  ORDER BY operational_activity_id, line_order, id
) sub
WHERE oa.id = sub.operational_activity_id
  AND oa.milestone_key = 'cargo_operations'
  AND oa.entry_type = 'activity'
  AND oa.deleted_at IS NULL;

DROP TABLE IF EXISTS operation_cargo_load_lines;

COMMIT;
