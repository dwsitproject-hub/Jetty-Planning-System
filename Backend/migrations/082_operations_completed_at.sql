-- Split ops-finished (sign-off) from vessel-departed (actual_completion_time at cast-off).
-- operations_completed_at: set when SIGNOFF_APPROVED
-- actual_completion_time: set when SAILED (cast_off_at)

BEGIN;

ALTER TABLE operations
  ADD COLUMN IF NOT EXISTS operations_completed_at TIMESTAMPTZ;

ALTER TABLE shipment_plans
  ADD COLUMN IF NOT EXISTS operations_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN operations.operations_completed_at IS
  'When cargo/QC operations were signed off (SIGNOFF_APPROVED). Vessel may still be at berth.';
COMMENT ON COLUMN shipment_plans.operations_completed_at IS
  'Plan-level mirror: latest operations_completed_at across child operations.';

-- Backfill operations: move mistaken sign-off actual_completion to operations_completed_at
UPDATE operations o
SET
  operations_completed_at = COALESCE(o.operations_completed_at, o.actual_completion_time),
  actual_completion_time = NULL
WHERE o.deleted_at IS NULL
  AND o.status IN ('SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED')
  AND o.actual_completion_time IS NOT NULL;

-- SAILED: preserve ops-completed; actual_completion = cast_off when missing
UPDATE operations o
SET
  operations_completed_at = COALESCE(o.operations_completed_at, o.actual_completion_time),
  actual_completion_time = COALESCE(o.actual_completion_time, o.cast_off_at)
WHERE o.deleted_at IS NULL
  AND o.status = 'SAILED'
  AND (o.actual_completion_time IS NOT NULL OR o.cast_off_at IS NOT NULL);

-- Backfill shipment_plans from child operations (max per plan)
UPDATE shipment_plans sp
SET
  operations_completed_at = sub.ops_completed,
  actual_completion_time = CASE
    WHEN sub.has_sailed THEN COALESCE(sp.actual_completion_time, sub.act_comp, sp.cast_off_at)
    WHEN sub.has_signoff_only THEN NULL
    ELSE sp.actual_completion_time
  END
FROM (
  SELECT
    si.shipment_plan_id AS plan_id,
    MAX(o.operations_completed_at) AS ops_completed,
    MAX(o.actual_completion_time) FILTER (WHERE o.status = 'SAILED') AS act_comp,
    BOOL_OR(o.status = 'SAILED') AS has_sailed,
    BOOL_OR(o.status IN ('SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED')) AS has_signoff_only
  FROM operations o
  JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
  WHERE o.deleted_at IS NULL
    AND si.shipment_plan_id IS NOT NULL
  GROUP BY si.shipment_plan_id
) sub
WHERE sp.id = sub.plan_id
  AND sp.deleted_at IS NULL;

-- Plans with sign-off-only children that still have actual_completion on plan row
UPDATE shipment_plans sp
SET
  operations_completed_at = COALESCE(sp.operations_completed_at, sp.actual_completion_time),
  actual_completion_time = NULL
WHERE sp.deleted_at IS NULL
  AND sp.sailed_at IS NULL
  AND sp.actual_completion_time IS NOT NULL
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
