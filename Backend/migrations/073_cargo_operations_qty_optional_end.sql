-- Cargo Operations: optional end_at + moved quantity for loading-rate tracking.

BEGIN;

ALTER TABLE operation_operational_activities
  ADD COLUMN IF NOT EXISTS cargo_moved_qty NUMERIC(20, 6);

COMMENT ON COLUMN operation_operational_activities.cargo_moved_qty IS
  'For cargo_operations activities only: quantity moved this segment (same unit as SI primary breakdown line).';

ALTER TABLE operation_operational_activities
  DROP CONSTRAINT IF EXISTS chk_operational_activity_entry_fields;

ALTER TABLE operation_operational_activities
  ADD CONSTRAINT chk_operational_activity_entry_fields CHECK (
    (entry_type = 'activity' AND reason IS NULL AND start_at IS NOT NULL AND (
      (milestone_key IN ('opening_hatch', 'cargo_pre_conditioning', 'cargo_operations')
        AND (end_at IS NULL OR end_at >= start_at))
      OR (milestone_key NOT IN ('opening_hatch', 'cargo_pre_conditioning', 'cargo_operations')
        AND end_at IS NOT NULL AND end_at >= start_at)
    ))
    OR (entry_type = 'milestone_na' AND start_at IS NULL AND end_at IS NULL)
  );

COMMIT;
