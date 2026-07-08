-- Rollback 073: remove cargo_moved_qty; restore end_at required for cargo_operations.

BEGIN;

-- Restore non-null end_at for rows that used optional end (required by pre-073 constraint).
UPDATE operation_operational_activities
SET end_at = start_at
WHERE milestone_key = 'cargo_operations'
  AND entry_type = 'activity'
  AND deleted_at IS NULL
  AND end_at IS NULL
  AND start_at IS NOT NULL;

ALTER TABLE operation_operational_activities
  DROP CONSTRAINT IF EXISTS chk_operational_activity_entry_fields;

ALTER TABLE operation_operational_activities
  ADD CONSTRAINT chk_operational_activity_entry_fields CHECK (
    (entry_type = 'activity' AND reason IS NULL AND start_at IS NOT NULL AND (
      (milestone_key IN ('opening_hatch', 'cargo_pre_conditioning') AND (end_at IS NULL OR end_at >= start_at))
      OR (milestone_key NOT IN ('opening_hatch', 'cargo_pre_conditioning') AND end_at IS NOT NULL AND end_at >= start_at)
    ))
    OR (entry_type = 'milestone_na' AND start_at IS NULL AND end_at IS NULL)
  );

ALTER TABLE operation_operational_activities
  DROP COLUMN IF EXISTS cargo_moved_qty;

COMMIT;
