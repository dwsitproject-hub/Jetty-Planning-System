-- Merge Pre-Checking tank_inspection + hold_inspection into a single inspection step.
-- Requires migration 051 (si_commodities.commodity_type) for consistent payload inspectionType.

BEGIN;

INSERT INTO operation_sub_processes (
  operation_id,
  phase,
  sub_process_key,
  status,
  occurred_at,
  start_at,
  end_at,
  skip_reason,
  remark,
  payload_json,
  created_at,
  updated_at
)
SELECT
  b.operation_id,
  'Pre-Checking',
  'inspection',
  CASE
    WHEN COALESCE(t.status, 'Pending') = 'Done' OR COALESCE(h.status, 'Pending') = 'Done' THEN 'Done'
    WHEN COALESCE(t.status, 'Pending') = 'In Progress' OR COALESCE(h.status, 'Pending') = 'In Progress' THEN 'In Progress'
    WHEN COALESCE(t.status, 'Pending') = 'Skipped' OR COALESCE(h.status, 'Pending') = 'Skipped' THEN 'Skipped'
    ELSE COALESCE(t.status, h.status, 'Pending')
  END,
  COALESCE(t.occurred_at, h.occurred_at),
  COALESCE(t.start_at, h.start_at),
  COALESCE(t.end_at, h.end_at),
  COALESCE(NULLIF(t.skip_reason, ''), NULLIF(h.skip_reason, '')),
  TRIM(BOTH E'\n' FROM CONCAT_WS(E'\n', NULLIF(TRIM(t.remark), ''), NULLIF(TRIM(h.remark), ''))),
  jsonb_build_object(
    'inspectionType',
    CASE WHEN COALESCE(si_ct.commodity_type, 'Liquid') = 'Solid' THEN 'Hold' ELSE 'Tank' END,
    'migratedFrom',
    CASE
      WHEN t.id IS NOT NULL AND h.id IS NOT NULL THEN 'tank_inspection+hold_inspection'
      WHEN t.id IS NOT NULL THEN 'tank_inspection'
      ELSE 'hold_inspection'
    END
  ),
  NOW(),
  NOW()
FROM (
  SELECT DISTINCT sp.operation_id
  FROM operation_sub_processes sp
  WHERE sp.phase = 'Pre-Checking'
    AND sp.sub_process_key IN ('tank_inspection', 'hold_inspection')
    AND sp.deleted_at IS NULL
) b
LEFT JOIN operation_sub_processes t
  ON t.operation_id = b.operation_id
  AND t.phase = 'Pre-Checking'
  AND t.sub_process_key = 'tank_inspection'
  AND t.deleted_at IS NULL
LEFT JOIN operation_sub_processes h
  ON h.operation_id = b.operation_id
  AND h.phase = 'Pre-Checking'
  AND h.sub_process_key = 'hold_inspection'
  AND h.deleted_at IS NULL
LEFT JOIN operations o ON o.id = b.operation_id AND o.deleted_at IS NULL
LEFT JOIN LATERAL (
  SELECT sc.commodity_type
  FROM shipping_instruction_breakdown br
  JOIN si_commodities sc ON sc.id = br.commodity_id AND sc.deleted_at IS NULL
  WHERE br.shipping_instruction_id = o.shipping_instruction_id AND br.deleted_at IS NULL
  ORDER BY br.line_order, br.id
  LIMIT 1
) si_ct ON TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM operation_sub_processes ex
  WHERE ex.operation_id = b.operation_id
    AND ex.phase = 'Pre-Checking'
    AND ex.sub_process_key = 'inspection'
    AND ex.deleted_at IS NULL
);

UPDATE operation_sub_process_documents d
SET sub_process_id = ins.id, updated_at = NOW()
FROM operation_sub_processes old
INNER JOIN operation_sub_processes ins
  ON ins.operation_id = old.operation_id
  AND ins.phase = 'Pre-Checking'
  AND ins.sub_process_key = 'inspection'
  AND ins.deleted_at IS NULL
WHERE d.sub_process_id = old.id
  AND old.phase = 'Pre-Checking'
  AND old.sub_process_key IN ('tank_inspection', 'hold_inspection')
  AND old.deleted_at IS NULL;

UPDATE operation_sub_processes
SET deleted_at = NOW(), updated_at = NOW()
WHERE phase = 'Pre-Checking'
  AND sub_process_key IN ('tank_inspection', 'hold_inspection')
  AND deleted_at IS NULL;

COMMIT;
