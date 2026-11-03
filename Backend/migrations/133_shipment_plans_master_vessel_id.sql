-- Optional link from a shipment plan to master_vessels.
-- Null means a legacy plan: vessel name and dimensions stay as typed on the plan.
-- No backfill. New plans copy name, LOA, GT, and draft from master at save time.

BEGIN;

ALTER TABLE shipment_plans
  ADD COLUMN IF NOT EXISTS master_vessel_id BIGINT REFERENCES master_vessels(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_shipment_plans_master_vessel_id
  ON shipment_plans (master_vessel_id)
  WHERE master_vessel_id IS NOT NULL;

COMMENT ON COLUMN shipment_plans.master_vessel_id IS
  'Master vessel chosen for this plan. Null on plans created before the link. Name, LOA, GT, and draft on the plan are a snapshot, not a live join.';

COMMIT;
