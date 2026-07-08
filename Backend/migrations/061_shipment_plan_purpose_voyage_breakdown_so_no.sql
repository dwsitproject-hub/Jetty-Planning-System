-- Plan-level purpose & voyage; SO No on SI breakdown lines.

BEGIN;

ALTER TABLE public.shipment_plans
  ADD COLUMN IF NOT EXISTS purpose_id BIGINT REFERENCES public.si_purposes(id) ON DELETE SET NULL;

ALTER TABLE public.shipment_plans
  ADD COLUMN IF NOT EXISTS voyage_no TEXT;

ALTER TABLE public.shipping_instruction_breakdown
  ADD COLUMN IF NOT EXISTS so_no TEXT;

-- Backfill plan purpose from first linked SI (when any).
UPDATE public.shipment_plans sp
SET purpose_id = x.pid
FROM (
  SELECT DISTINCT ON (si.shipment_plan_id)
    si.shipment_plan_id AS plan_id,
    si.purpose_id AS pid
  FROM public.shipping_instructions si
  WHERE si.deleted_at IS NULL
    AND si.shipment_plan_id IS NOT NULL
    AND si.purpose_id IS NOT NULL
  ORDER BY si.shipment_plan_id, si.id
) x
WHERE sp.id = x.plan_id
  AND sp.purpose_id IS NULL
  AND x.pid IS NOT NULL;

COMMENT ON COLUMN public.shipment_plans.purpose_id IS 'Vessel call purpose (Loading/Unloading); canonical for all SIs on this plan.';
COMMENT ON COLUMN public.shipment_plans.voyage_no IS 'Voyage number for the vessel call; propagated to child SIs.';
COMMENT ON COLUMN public.shipping_instruction_breakdown.so_no IS 'Sales order number (optional line-level reference).';

COMMIT;
