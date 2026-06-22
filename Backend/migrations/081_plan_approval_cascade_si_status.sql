-- Plan-level approval is authoritative: child SI status mirrors plan approval_status.
-- Backfill: Approved plans → all child SIs set to Approved.

BEGIN;

UPDATE public.shipping_instructions si
SET status = 'Approved',
    updated_at = NOW()
FROM public.shipment_plans sp
WHERE si.shipment_plan_id = sp.id
  AND si.deleted_at IS NULL
  AND sp.deleted_at IS NULL
  AND sp.approval_status = 'Approved'
  AND si.status <> 'Approved';

COMMIT;
