-- Copy DataHub vessel type and hull type onto a linked shipment plan.
-- Both are optional text enums on the hub (not numbers). Legacy plans stay null.
-- Plans already linked copy the current master values into the new columns only.

BEGIN;

ALTER TABLE shipment_plans
  ADD COLUMN IF NOT EXISTS vessel_type TEXT,
  ADD COLUMN IF NOT EXISTS vessel_hull_type TEXT;

COMMENT ON COLUMN shipment_plans.vessel_type IS
  'Snapshot of master_vessels.vessel_type (DataHub Vessel_Type). Null on legacy plans.';
COMMENT ON COLUMN shipment_plans.vessel_hull_type IS
  'Snapshot of master_vessels.type_lambung (DataHub Type_lambung). Null on legacy plans.';

UPDATE shipment_plans sp
SET vessel_type = mv.vessel_type,
    vessel_hull_type = mv.type_lambung
FROM master_vessels mv
WHERE sp.master_vessel_id = mv.id
  AND sp.master_vessel_id IS NOT NULL;

COMMIT;
