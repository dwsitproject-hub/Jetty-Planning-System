-- Rename opening_h1_h2 → opening_hatch; allow NULL end_at for start-only operational activities
-- (Opening Hatch + Cargo Pre-Conditioning).

BEGIN;

UPDATE operation_operational_activities
SET milestone_key = 'opening_hatch'
WHERE milestone_key = 'opening_h1_h2' AND deleted_at IS NULL;

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

COMMIT;
