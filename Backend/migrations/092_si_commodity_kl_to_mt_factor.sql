-- Per-commodity KL → MT conversion factor for DWT / vessel_capacity calculation.

BEGIN;

ALTER TABLE si_commodities ADD COLUMN IF NOT EXISTS kl_to_mt_factor NUMERIC(10,6)
  CHECK (kl_to_mt_factor IS NULL OR kl_to_mt_factor > 0);

COMMENT ON COLUMN si_commodities.kl_to_mt_factor IS
  'KL to MT conversion factor for DWT calculation. E.g. 0.8743 means 1 KL = 0.8743 MT.';

-- Backfill vessel_capacity using MT qty + converted KL qty per commodity factor.
UPDATE shipment_plans sp
SET vessel_capacity = sub.total_mt_equiv,
    updated_at = NOW()
FROM (
  SELECT si.shipment_plan_id AS plan_id,
         SUM(
           CASE UPPER(m.code)
             WHEN 'MT' THEN sib.qty
             WHEN 'KL' THEN sib.qty * COALESCE(c.kl_to_mt_factor, 0)
             ELSE 0
           END
         )::numeric AS total_mt_equiv
  FROM shipping_instruction_breakdown sib
  JOIN shipping_instructions si ON si.id = sib.shipping_instruction_id AND si.deleted_at IS NULL
  JOIN metric m ON m.id = sib.metric_id AND m.deleted_at IS NULL
  JOIN si_commodities c ON c.id = sib.commodity_id AND c.deleted_at IS NULL
  WHERE sib.deleted_at IS NULL
    AND sib.qty > 0
  GROUP BY si.shipment_plan_id
  HAVING SUM(
    CASE UPPER(m.code)
      WHEN 'MT' THEN sib.qty
      WHEN 'KL' THEN sib.qty * COALESCE(c.kl_to_mt_factor, 0)
      ELSE 0
    END
  ) > 0
) sub
WHERE sp.id = sub.plan_id
  AND sp.deleted_at IS NULL;

COMMIT;
