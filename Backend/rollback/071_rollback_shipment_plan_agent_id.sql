BEGIN;

DROP INDEX IF EXISTS idx_shipment_plans_agent_id;

ALTER TABLE shipment_plans DROP COLUMN IF EXISTS agent_id;

COMMIT;
