-- Vessel-call level agent on shipment_plans; child SIs may still carry agent_id for legacy reads until synced.

BEGIN;

ALTER TABLE shipment_plans
  ADD COLUMN IF NOT EXISTS agent_id BIGINT REFERENCES si_agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shipment_plans_agent_id
  ON shipment_plans (agent_id) WHERE agent_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN shipment_plans.agent_id IS
  'Chartering / vessel-call agent (master si_agents). Canonical for the plan; child shipping_instructions.agent_id may mirror for joins.';

-- Backfill from first child SI with a non-null agent per plan (deterministic by SI id).
UPDATE shipment_plans sp
SET agent_id = sub.agent_id
FROM (
  SELECT DISTINCT ON (si.shipment_plan_id)
    si.shipment_plan_id AS plan_id,
    si.agent_id
  FROM shipping_instructions si
  WHERE si.deleted_at IS NULL
    AND si.shipment_plan_id IS NOT NULL
    AND si.agent_id IS NOT NULL
  ORDER BY si.shipment_plan_id, si.id ASC
) sub
WHERE sp.id = sub.plan_id
  AND sp.deleted_at IS NULL
  AND sp.agent_id IS NULL;

COMMIT;
