-- Backfill cargo_handling_method_id on existing opening_hatch activities (Solid → conveyor, else → hose).

BEGIN;

WITH op_commodity AS (
  SELECT
    o.id AS operation_id,
    COALESCE(
      (SELECT sc.commodity_type
       FROM public.shipping_instruction_breakdown b
       JOIN public.si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
       WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
       ORDER BY b.line_order, b.id
       LIMIT 1),
      'Liquid'
    ) AS commodity_type
  FROM public.operations o
  JOIN public.shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
  WHERE o.deleted_at IS NULL
),
method_ids AS (
  SELECT
    (SELECT id FROM public.master_cargo_handling_methods
     WHERE code = 'conveyor' AND deleted_at IS NULL AND is_active = TRUE
     LIMIT 1) AS conveyor_id,
    (SELECT id FROM public.master_cargo_handling_methods
     WHERE code = 'hose' AND deleted_at IS NULL AND is_active = TRUE
     LIMIT 1) AS hose_id
)
UPDATE public.operation_operational_activities oa
SET
  cargo_handling_method_id = CASE
    WHEN oc.commodity_type = 'Solid' THEN mi.conveyor_id
    ELSE mi.hose_id
  END,
  updated_at = NOW()
FROM op_commodity oc, method_ids mi
WHERE oa.operation_id = oc.operation_id
  AND oa.milestone_key = 'opening_hatch'
  AND oa.entry_type = 'activity'
  AND oa.deleted_at IS NULL
  AND oa.cargo_handling_method_id IS NULL
  AND mi.conveyor_id IS NOT NULL
  AND mi.hose_id IS NOT NULL;

COMMIT;
