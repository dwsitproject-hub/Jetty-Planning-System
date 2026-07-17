-- Rollback 087: remove vessel_capacity from shipment_plans.

BEGIN;

ALTER TABLE shipment_plans
  DROP CONSTRAINT IF EXISTS shipment_plans_vessel_capacity_positive;

ALTER TABLE shipment_plans
  DROP COLUMN IF EXISTS vessel_capacity;

COMMIT;
