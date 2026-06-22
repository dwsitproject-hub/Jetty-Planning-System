-- SIGNOFF_APPROVED / SIGNOFF_REQUESTED must not have cast_off_at until SAILED (depart).
-- Seed / legacy rows may have cast_off without SAILED; schematic treats cast_off as sailed.

BEGIN;

UPDATE operations
SET cast_off_at = NULL,
    updated_at = NOW()
WHERE deleted_at IS NULL
  AND status IN ('SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED')
  AND cast_off_at IS NOT NULL;

UPDATE shipment_plans sp
SET cast_off_at = NULL,
    updated_at = NOW()
WHERE sp.deleted_at IS NULL
  AND sp.sailed_at IS NULL
  AND sp.cast_off_at IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM shipping_instructions si
    JOIN operations o ON o.shipping_instruction_id = si.id AND o.deleted_at IS NULL
    WHERE si.shipment_plan_id = sp.id
      AND si.deleted_at IS NULL
      AND o.status IN ('SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM shipping_instructions si
    JOIN operations o ON o.shipping_instruction_id = si.id AND o.deleted_at IS NULL
    WHERE si.shipment_plan_id = sp.id
      AND si.deleted_at IS NULL
      AND o.status = 'SAILED'
  );

COMMIT;
