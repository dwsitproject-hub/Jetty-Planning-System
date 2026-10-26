-- Rollback 133: remove the shipment plan link to master_vessels.

BEGIN;

DROP INDEX IF EXISTS idx_shipment_plans_master_vessel_id;

ALTER TABLE shipment_plans
  DROP COLUMN IF EXISTS master_vessel_id;

COMMIT;
