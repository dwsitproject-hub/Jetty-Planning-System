-- Jetty Planning System - Migration 024
-- Dev seed: pre-checking subprocess data + sample document metadata
-- for seeded operations created in 023_seed_dev_operational_data.sql.

BEGIN;

-- Seed pre-checking subprocess rows (idempotent by operation + phase + key).
INSERT INTO operation_sub_processes (
  operation_id,
  phase,
  sub_process_key,
  status,
  occurred_at,
  remark,
  payload_json,
  created_at,
  updated_at
)
SELECT
  o.id,
  'Pre-Checking',
  v.sub_process_key,
  v.status,
  v.occurred_at,
  v.remark,
  v.payload_json::jsonb,
  NOW(),
  NOW()
FROM (
  VALUES
    ('SEED-SI-2026-0001', 'key_meeting',      'Done',        TIMESTAMPTZ '2026-03-24 07:40:00+00', 'Kick-off completed, all teams aligned.', '{}'::text),
    ('SEED-SI-2026-0001', 'sampling',         'Done',        TIMESTAMPTZ '2026-03-24 08:30:00+00', 'Sampling completed.', '{"records":[{"id":"seed-s1","noPalka":"1P","ffa":"4.95","moisture":"0.28"},{"id":"seed-s2","noPalka":"2P","ffa":"4.90","moisture":"0.31"}]}'::text),
    ('SEED-SI-2026-0001', 'initial_sounding', 'Done',        TIMESTAMPTZ '2026-03-24 09:00:00+00', 'Initial sounding stable.', '{}'::text),

    ('SEED-SI-2026-0002', 'key_meeting',      'Done',        TIMESTAMPTZ '2026-03-24 12:15:00+00', 'Unloading team briefing complete.', '{}'::text),
    ('SEED-SI-2026-0002', 'sampling',         'In Progress', TIMESTAMPTZ '2026-03-24 13:20:00+00', 'First sample batch recorded.', '{"records":[{"id":"seed-s3","noPalka":"1P","ffa":"4.88","moisture":"0.26"}]}'::text),
    ('SEED-SI-2026-0002', 'initial_sounding', 'Done',        TIMESTAMPTZ '2026-03-24 13:05:00+00', 'Initial sounding logged.', '{}'::text),

    ('SEED-SI-2026-0003', 'key_meeting',      'In Progress', TIMESTAMPTZ '2026-03-25 02:30:00+00', 'Pre-arrival coordination in progress.', '{}'::text),
    ('SEED-SI-2026-0003', 'sampling',         'Pending',     NULL,                                    '', '{"records":[]}'::text),
    ('SEED-SI-2026-0003', 'initial_sounding', 'Pending',     NULL,                                    '', '{}'::text)
) AS v(reference_number, sub_process_key, status, occurred_at, remark, payload_json)
JOIN shipping_instructions si
  ON si.reference_number = v.reference_number
 AND si.deleted_at IS NULL
JOIN operations o
  ON o.shipping_instruction_id = si.id
 AND o.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM operation_sub_processes sp
  WHERE sp.operation_id = o.id
    AND sp.phase = 'Pre-Checking'
    AND sp.sub_process_key = v.sub_process_key
    AND sp.deleted_at IS NULL
);

-- Seed sample document metadata (no physical files required).
INSERT INTO operation_sub_process_documents (
  sub_process_id,
  original_name,
  stored_name,
  stored_path,
  mime_type,
  size_bytes,
  created_at,
  updated_at
)
SELECT
  sp.id,
  d.original_name,
  d.stored_name,
  d.stored_path,
  d.mime_type,
  d.size_bytes,
  NOW(),
  NOW()
FROM (
  VALUES
    ('SEED-SI-2026-0001', 'key_meeting',      'seed-key-meeting-notes.pdf',   'seed-key-meeting-notes.pdf',   'operations/seed/sub-processes/key_meeting/seed-key-meeting-notes.pdf',   'application/pdf', 24576::bigint),
    ('SEED-SI-2026-0001', 'initial_sounding', 'seed-initial-sounding.jpg',     'seed-initial-sounding.jpg',     'operations/seed/sub-processes/initial_sounding/seed-initial-sounding.jpg', 'image/jpeg',       184320::bigint),
    ('SEED-SI-2026-0002', 'sampling',         'seed-sampling-sheet.png',       'seed-sampling-sheet.png',       'operations/seed/sub-processes/sampling/seed-sampling-sheet.png',           'image/png',        112640::bigint)
) AS d(reference_number, sub_process_key, original_name, stored_name, stored_path, mime_type, size_bytes)
JOIN shipping_instructions si
  ON si.reference_number = d.reference_number
 AND si.deleted_at IS NULL
JOIN operations o
  ON o.shipping_instruction_id = si.id
 AND o.deleted_at IS NULL
JOIN operation_sub_processes sp
  ON sp.operation_id = o.id
 AND sp.phase = 'Pre-Checking'
 AND sp.sub_process_key = d.sub_process_key
 AND sp.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM operation_sub_process_documents x
  WHERE x.sub_process_id = sp.id
    AND x.stored_name = d.stored_name
    AND x.deleted_at IS NULL
);

COMMIT;
