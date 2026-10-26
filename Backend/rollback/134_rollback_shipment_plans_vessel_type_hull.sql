-- Rollback 134: drop the vessel type and hull snapshots on shipment plans.

BEGIN;

ALTER TABLE shipment_plans
  DROP COLUMN IF EXISTS vessel_hull_type,
  DROP COLUMN IF EXISTS vessel_type;

COMMIT;
