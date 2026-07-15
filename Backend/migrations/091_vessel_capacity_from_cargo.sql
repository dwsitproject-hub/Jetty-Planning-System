-- vessel_capacity is now derived from shipping instruction breakdown MT totals (synced by API).
-- Backfill existing plans from breakdown sums.

BEGIN;

COMMENT ON COLUMN shipment_plans.vessel_capacity IS
  'Total cargo quantity (MT) derived from shipping instruction breakdown; synced automatically.';

UPDATE shipment_plans sp
SET vessel_capacity = sub.total_mt
FROM (
  SELECT si.shipment_plan_id AS plan_id,
         SUM(sib.qty)::numeric AS total_mt
  FROM shipping_instruction_breakdown sib
  JOIN shipping_instructions si ON si.id = sib.shipping_instruction_id AND si.deleted_at IS NULL
  JOIN metric m ON m.id = sib.metric_id AND m.deleted_at IS NULL AND UPPER(m.code) = 'MT'
  WHERE sib.deleted_at IS NULL AND sib.qty > 0
  GROUP BY si.shipment_plan_id
) sub
WHERE sp.id = sub.plan_id
  AND sp.deleted_at IS NULL;

-- Plans with no MT breakdown: leave existing manual values unless all child SIs have zero MT.
UPDATE shipment_plans sp
SET vessel_capacity = NULL
WHERE sp.deleted_at IS NULL
  AND sp.id NOT IN (
    SELECT DISTINCT si.shipment_plan_id
    FROM shipping_instruction_breakdown sib
    JOIN shipping_instructions si ON si.id = sib.shipping_instruction_id AND si.deleted_at IS NULL
    JOIN metric m ON m.id = sib.metric_id AND m.deleted_at IS NULL AND UPPER(m.code) = 'MT'
    WHERE sib.deleted_at IS NULL AND sib.qty > 0
  )
  AND EXISTS (
    SELECT 1 FROM shipping_instructions si
    WHERE si.shipment_plan_id = sp.id AND si.deleted_at IS NULL
  );

COMMIT;
