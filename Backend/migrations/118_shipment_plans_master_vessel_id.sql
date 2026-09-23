-- Link shipment plans to master_vessels (snapshot model). No backfill - legacy plans keep master_vessel_id NULL.

BEGIN;

ALTER TABLE shipment_plans
  ADD COLUMN IF NOT EXISTS master_vessel_id BIGINT REFERENCES master_vessels(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_shipment_plans_master_vessel_id
  ON shipment_plans (master_vessel_id)
  WHERE master_vessel_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN shipment_plans.master_vessel_id IS
  'FK to master_vessels when the plan was created from master data. vessel_name/LOA/GT/draft on the plan are snapshots; NULL for legacy free-text plans.';

COMMIT;
