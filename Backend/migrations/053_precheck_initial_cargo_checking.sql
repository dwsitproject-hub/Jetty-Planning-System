-- Merge Pre-Checking initial_sounding + initial_draft_survey into initial_cargo_checking.
-- Requires migration 051 (si_commodities.commodity_type).

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
  'initial_cargo_checking',
  CASE
    WHEN COALESCE(s.status, 'Pending') = 'Done' OR COALESCE(d.status, 'Pending') = 'Done' THEN 'Done'
    WHEN COALESCE(s.status, 'Pending') = 'In Progress' OR COALESCE(d.status, 'Pending') = 'In Progress' THEN 'In Progress'
    WHEN COALESCE(s.status, 'Pending') = 'Skipped' OR COALESCE(d.status, 'Pending') = 'Skipped' THEN 'Skipped'
    ELSE COALESCE(s.status, d.status, 'Pending')
  END,
  COALESCE(s.occurred_at, d.occurred_at),
  COALESCE(s.start_at, d.start_at),
  COALESCE(s.end_at, d.end_at),
  COALESCE(NULLIF(s.skip_reason, ''), NULLIF(d.skip_reason, '')),
  TRIM(BOTH E'\n' FROM CONCAT_WS(E'\n', NULLIF(TRIM(s.remark), ''), NULLIF(TRIM(d.remark), ''))),
  jsonb_build_object(
    'cargoCheckingType',
    CASE WHEN COALESCE(si_ct.commodity_type, 'Liquid') = 'Solid' THEN 'Draft Survey' ELSE 'Sounding' END,
    'migratedFrom',
    CASE
      WHEN s.id IS NOT NULL AND d.id IS NOT NULL THEN 'initial_sounding+initial_draft_survey'
      WHEN s.id IS NOT NULL THEN 'initial_sounding'
      ELSE 'initial_draft_survey'
    END
  ),
  NOW(),
  NOW()
FROM (
  SELECT DISTINCT sp.operation_id
  FROM operation_sub_processes sp
  WHERE sp.phase = 'Pre-Checking'
    AND sp.sub_process_key IN ('initial_sounding', 'initial_draft_survey')
    AND sp.deleted_at IS NULL
) b
LEFT JOIN operation_sub_processes s
  ON s.operation_id = b.operation_id
  AND s.phase = 'Pre-Checking'
  AND s.sub_process_key = 'initial_sounding'
  AND s.deleted_at IS NULL
LEFT JOIN operation_sub_processes d
  ON d.operation_id = b.operation_id
  AND d.phase = 'Pre-Checking'
  AND d.sub_process_key = 'initial_draft_survey'
  AND d.deleted_at IS NULL
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
    AND ex.sub_process_key = 'initial_cargo_checking'
    AND ex.deleted_at IS NULL
);

UPDATE operation_sub_process_documents doc
SET sub_process_id = ins.id, updated_at = NOW()
FROM operation_sub_processes old
INNER JOIN operation_sub_processes ins
  ON ins.operation_id = old.operation_id
  AND ins.phase = 'Pre-Checking'
  AND ins.sub_process_key = 'initial_cargo_checking'
  AND ins.deleted_at IS NULL
WHERE doc.sub_process_id = old.id
  AND old.phase = 'Pre-Checking'
  AND old.sub_process_key IN ('initial_sounding', 'initial_draft_survey')
  AND old.deleted_at IS NULL;

UPDATE operation_sub_processes
SET deleted_at = NOW(), updated_at = NOW()
WHERE phase = 'Pre-Checking'
  AND sub_process_key IN ('initial_sounding', 'initial_draft_survey')
  AND deleted_at IS NULL;

COMMIT;
