-- Soft delete for shipment plans (list/detail hide; child SIs soft-deleted with plan delete).

BEGIN;

ALTER TABLE shipment_plans
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_shipment_plans_port_deleted
  ON shipment_plans (port_id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN shipment_plans.deleted_at IS 'When set, plan is removed from UI; child SIs are soft-deleted in same transaction.';

COMMIT;
