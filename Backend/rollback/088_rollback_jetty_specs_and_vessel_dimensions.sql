-- Rollback 088: remove jetty specs and vessel dimensions.

BEGIN;

ALTER TABLE shipment_plans
  DROP COLUMN IF EXISTS vessel_dwt,
  DROP COLUMN IF EXISTS vessel_draft,
  DROP COLUMN IF EXISTS vessel_gross_tonnage,
  DROP COLUMN IF EXISTS vessel_loa_m;

ALTER TABLE shipment_plans
  DROP CONSTRAINT IF EXISTS shipment_plans_vessel_loa_positive,
  DROP CONSTRAINT IF EXISTS shipment_plans_vessel_gt_positive,
  DROP CONSTRAINT IF EXISTS shipment_plans_vessel_draft_positive;

ALTER TABLE jetties
  DROP CONSTRAINT IF EXISTS jetties_length_positive,
  DROP CONSTRAINT IF EXISTS jetties_draft_positive,
  DROP CONSTRAINT IF EXISTS jetties_dwt_positive;

ALTER TABLE jetties
  DROP COLUMN IF EXISTS jetty_dwt,
  DROP COLUMN IF EXISTS jetty_draft,
  DROP COLUMN IF EXISTS jetty_length_m;

COMMIT;
