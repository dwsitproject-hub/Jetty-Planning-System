-- Fix corrupt TA year 0206 → 2026 for BG. SUMBER KAPUAS 232 (UN-26-08-0001).
-- Audit: JPS-Dashboard-Consistency-Audit — F1. ETC left unchanged pending business review.

UPDATE operations
SET ta = TIMESTAMPTZ '2026-07-10T22:02:24Z',
    updated_at = NOW()
WHERE deleted_at IS NULL
  AND jetty_operation_code = 'UN-26-08-0001';

UPDATE shipment_plans sp
SET ta = TIMESTAMPTZ '2026-07-10T22:02:24Z',
    updated_at = NOW()
FROM shipping_instructions si
JOIN operations o ON o.shipping_instruction_id = si.id AND o.deleted_at IS NULL
WHERE si.shipment_plan_id = sp.id
  AND sp.deleted_at IS NULL
  AND o.jetty_operation_code = 'UN-26-08-0001';
