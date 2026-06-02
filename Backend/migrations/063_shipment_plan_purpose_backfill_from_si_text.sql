-- Ensure shipment_plans.purpose_id is set when it was only derivable from child SI
-- (061 backfilled from si.purpose_id; this adds fallback from si.purpose text → si_purposes).

BEGIN;

UPDATE public.shipment_plans sp
SET purpose_id = x.pid
FROM (
  SELECT DISTINCT ON (si.shipment_plan_id)
    si.shipment_plan_id AS plan_id,
    COALESCE(
      si.purpose_id,
      (
        SELECT p.id
        FROM public.si_purposes p
        WHERE p.deleted_at IS NULL
          AND LOWER(TRIM(BOTH FROM p.code)) = LOWER(TRIM(BOTH FROM COALESCE(si.purpose, '')))
        LIMIT 1
      ),
      (
        SELECT p.id
        FROM public.si_purposes p
        WHERE p.deleted_at IS NULL
          AND LOWER(TRIM(BOTH FROM p.label)) = LOWER(TRIM(BOTH FROM COALESCE(si.purpose, '')))
        LIMIT 1
      )
    ) AS pid
  FROM public.shipping_instructions si
  WHERE si.deleted_at IS NULL
    AND si.shipment_plan_id IS NOT NULL
  ORDER BY si.shipment_plan_id, si.id
) x
WHERE sp.id = x.plan_id
  AND sp.deleted_at IS NULL
  AND sp.purpose_id IS NULL
  AND x.pid IS NOT NULL;

COMMENT ON COLUMN public.shipment_plans.purpose_id IS
  'Vessel call purpose (Loading/Unloading); canonical for all SIs on this plan.';

COMMIT;
