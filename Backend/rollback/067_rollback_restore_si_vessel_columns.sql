-- Emergency rollback after migration 067 (drop vessel-call columns from shipping_instructions).
-- Use when you must revert the database schema before redeploying an older API that still
-- expects mirrored columns on shipping_instructions. Prefer a full pg_dump restore when possible.
--
-- Does NOT remove shipment_plans.approval_id (066); handle that separately if the old code conflicts.
--
-- After this script: redeploy the previous application version and verify SI create/edit and allocation.

BEGIN;

ALTER TABLE public.shipping_instructions ADD COLUMN IF NOT EXISTS vessel_name TEXT;
ALTER TABLE public.shipping_instructions ADD COLUMN IF NOT EXISTS purpose TEXT;
ALTER TABLE public.shipping_instructions ADD COLUMN IF NOT EXISTS eta TIMESTAMPTZ;
ALTER TABLE public.shipping_instructions ADD COLUMN IF NOT EXISTS purpose_id BIGINT REFERENCES public.si_purposes(id);
ALTER TABLE public.shipping_instructions ADD COLUMN IF NOT EXISTS preferred_jetty_id BIGINT REFERENCES public.jetties(id);
ALTER TABLE public.shipping_instructions ADD COLUMN IF NOT EXISTS approval_id TEXT;
ALTER TABLE public.shipping_instructions ADD COLUMN IF NOT EXISTS voyage_no TEXT;
ALTER TABLE public.shipping_instructions ADD COLUMN IF NOT EXISTS approved_by_user_id BIGINT REFERENCES public.users(id);
ALTER TABLE public.shipping_instructions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.shipping_instructions ADD COLUMN IF NOT EXISTS port_id BIGINT REFERENCES public.ports(id);

UPDATE public.shipping_instructions si
SET
  vessel_name = sp.vessel_name,
  purpose_id = sp.purpose_id,
  purpose = spp.code,
  eta = sp.eta,
  preferred_jetty_id = sp.jetty_id,
  approval_id = sp.approval_id,
  voyage_no = sp.voyage_no,
  approved_by_user_id = sp.approved_by_user_id,
  approved_at = sp.approved_at,
  port_id = sp.port_id
FROM public.shipment_plans sp
LEFT JOIN public.si_purposes spp ON spp.id = sp.purpose_id AND spp.deleted_at IS NULL
WHERE si.shipment_plan_id = sp.id
  AND sp.deleted_at IS NULL;

COMMIT;
