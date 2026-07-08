-- Remove vessel-call attributes from shipping_instructions (canonical copy lives on shipment_plans).
-- Depends on 066 (plan backfill + SI vessel_name/purpose nullable).

BEGIN;

ALTER TABLE public.shipping_instructions
  DROP COLUMN IF EXISTS vessel_name,
  DROP COLUMN IF EXISTS purpose,
  DROP COLUMN IF EXISTS eta,
  DROP COLUMN IF EXISTS purpose_id,
  DROP COLUMN IF EXISTS preferred_jetty_id,
  DROP COLUMN IF EXISTS approval_id,
  DROP COLUMN IF EXISTS voyage_no,
  DROP COLUMN IF EXISTS approved_by_user_id,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS port_id;

COMMIT;
