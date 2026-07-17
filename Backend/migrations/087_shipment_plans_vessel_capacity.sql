-- Add vessel capacity to shipment_plans (vessel-level attribute, canonical on the plan).
-- Required on new plans via the API; column stays nullable so legacy rows are unaffected.

BEGIN;

ALTER TABLE shipment_plans
  ADD COLUMN IF NOT EXISTS vessel_capacity NUMERIC(14,3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipment_plans_vessel_capacity_positive'
  ) THEN
    ALTER TABLE shipment_plans
      ADD CONSTRAINT shipment_plans_vessel_capacity_positive
      CHECK (vessel_capacity IS NULL OR vessel_capacity > 0);
  END IF;
END $$;

COMMENT ON COLUMN shipment_plans.vessel_capacity IS
  'Vessel capacity (numeric, e.g. deadweight tonnage). Required on new plans via API; nullable for legacy rows.';

COMMIT;
