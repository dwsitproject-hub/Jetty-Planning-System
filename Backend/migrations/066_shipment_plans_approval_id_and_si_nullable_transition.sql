-- Shipment plan: persist approval_id string (moved from shipping_instructions in 067).
-- Backfill plan vessel-call fields from child SI where plan values are null (last writer wins by min si.id).
-- Relax SI NOT NULL on vessel_name / purpose so application can stop writing them before columns are dropped.

BEGIN;

ALTER TABLE public.shipment_plans
  ADD COLUMN IF NOT EXISTS approval_id TEXT;

COMMENT ON COLUMN public.shipment_plans.approval_id IS
  'External approval reference string (migrated from shipping_instructions.approval_id).';

UPDATE public.shipment_plans sp
SET approval_id = COALESCE(sp.approval_id, x.aid)
FROM (
  SELECT DISTINCT ON (si.shipment_plan_id)
    si.shipment_plan_id AS plan_id,
    NULLIF(TRIM(si.approval_id), '') AS aid
  FROM public.shipping_instructions si
  WHERE si.deleted_at IS NULL
    AND si.shipment_plan_id IS NOT NULL
    AND si.approval_id IS NOT NULL
    AND TRIM(si.approval_id) <> ''
  ORDER BY si.shipment_plan_id, si.id
) x
WHERE sp.id = x.plan_id
  AND sp.deleted_at IS NULL
  AND (sp.approval_id IS NULL OR TRIM(sp.approval_id) = '');

UPDATE public.shipment_plans sp
SET vessel_name = NULLIF(TRIM(x.vessel_name), '')
FROM (
  SELECT DISTINCT ON (si.shipment_plan_id)
    si.shipment_plan_id AS plan_id,
    si.vessel_name
  FROM public.shipping_instructions si
  WHERE si.deleted_at IS NULL
    AND si.shipment_plan_id IS NOT NULL
    AND si.vessel_name IS NOT NULL
    AND TRIM(si.vessel_name) <> ''
  ORDER BY si.shipment_plan_id, si.id
) x
WHERE sp.id = x.plan_id
  AND sp.deleted_at IS NULL
  AND (sp.vessel_name IS NULL OR TRIM(sp.vessel_name) = '');

UPDATE public.shipment_plans sp
SET eta = x.eta
FROM (
  SELECT DISTINCT ON (si.shipment_plan_id)
    si.shipment_plan_id AS plan_id,
    si.eta
  FROM public.shipping_instructions si
  WHERE si.deleted_at IS NULL
    AND si.shipment_plan_id IS NOT NULL
    AND si.eta IS NOT NULL
  ORDER BY si.shipment_plan_id, si.id
) x
WHERE sp.id = x.plan_id
  AND sp.deleted_at IS NULL
  AND sp.eta IS NULL;

UPDATE public.shipment_plans sp
SET purpose_id = x.purpose_id
FROM (
  SELECT DISTINCT ON (si.shipment_plan_id)
    si.shipment_plan_id AS plan_id,
    si.purpose_id
  FROM public.shipping_instructions si
  WHERE si.deleted_at IS NULL
    AND si.shipment_plan_id IS NOT NULL
    AND si.purpose_id IS NOT NULL
  ORDER BY si.shipment_plan_id, si.id
) x
WHERE sp.id = x.plan_id
  AND sp.deleted_at IS NULL
  AND sp.purpose_id IS NULL;

UPDATE public.shipment_plans sp
SET voyage_no = NULLIF(TRIM(x.voyage_no), '')
FROM (
  SELECT DISTINCT ON (si.shipment_plan_id)
    si.shipment_plan_id AS plan_id,
    si.voyage_no
  FROM public.shipping_instructions si
  WHERE si.deleted_at IS NULL
    AND si.shipment_plan_id IS NOT NULL
    AND si.voyage_no IS NOT NULL
    AND TRIM(si.voyage_no) <> ''
  ORDER BY si.shipment_plan_id, si.id
) x
WHERE sp.id = x.plan_id
  AND sp.deleted_at IS NULL
  AND (sp.voyage_no IS NULL OR TRIM(sp.voyage_no) = '');

UPDATE public.shipment_plans sp
SET jetty_id = x.preferred_jetty_id
FROM (
  SELECT DISTINCT ON (si.shipment_plan_id)
    si.shipment_plan_id AS plan_id,
    si.preferred_jetty_id
  FROM public.shipping_instructions si
  WHERE si.deleted_at IS NULL
    AND si.shipment_plan_id IS NOT NULL
    AND si.preferred_jetty_id IS NOT NULL
  ORDER BY si.shipment_plan_id, si.id
) x
WHERE sp.id = x.plan_id
  AND sp.deleted_at IS NULL
  AND sp.jetty_id IS NULL;

UPDATE public.shipment_plans sp
SET port_id = x.port_id
FROM (
  SELECT DISTINCT ON (si.shipment_plan_id)
    si.shipment_plan_id AS plan_id,
    si.port_id
  FROM public.shipping_instructions si
  WHERE si.deleted_at IS NULL
    AND si.shipment_plan_id IS NOT NULL
    AND si.port_id IS NOT NULL
  ORDER BY si.shipment_plan_id, si.id
) x
WHERE sp.id = x.plan_id
  AND sp.deleted_at IS NULL
  AND sp.port_id IS NULL;

UPDATE public.shipment_plans sp
SET
  approved_at = COALESCE(sp.approved_at, x.approved_at),
  approved_by_user_id = COALESCE(sp.approved_by_user_id, x.approved_by_user_id)
FROM (
  SELECT DISTINCT ON (si.shipment_plan_id)
    si.shipment_plan_id AS plan_id,
    si.approved_at,
    si.approved_by_user_id
  FROM public.shipping_instructions si
  WHERE si.deleted_at IS NULL
    AND si.shipment_plan_id IS NOT NULL
    AND (si.approved_at IS NOT NULL OR si.approved_by_user_id IS NOT NULL)
  ORDER BY si.shipment_plan_id, si.id DESC
) x
WHERE sp.id = x.plan_id
  AND sp.deleted_at IS NULL;

-- Allow API to omit SI vessel_name / purpose until columns are removed (067).
ALTER TABLE public.shipping_instructions
  ALTER COLUMN vessel_name DROP NOT NULL;

ALTER TABLE public.shipping_instructions
  ALTER COLUMN purpose DROP NOT NULL;

COMMIT;
