-- Jetty Planning System - Migration 031
-- Dev seed: clearance-focused operations for /verification testing.
-- Adds both READY TO SAIL (SIGNOFF_APPROVED) and SAILED rows, idempotently.

BEGIN;

-- 1) Seed dedicated Shipping Instructions for clearance testing.
INSERT INTO shipping_instructions (
  reference_number,
  vessel_name,
  purpose,
  status,
  eta,
  eta_from,
  eta_to,
  note,
  created_at,
  updated_at
)
SELECT
  v.reference_number,
  v.vessel_name,
  v.purpose,
  'Approved',
  v.eta,
  v.eta::date,
  (v.eta + INTERVAL '1 day')::date,
  'Seeded for Clearance module testing',
  NOW(),
  NOW()
FROM (
  VALUES
    ('SEED-CLR-2026-0001', 'MT CLEARWATER 01', 'Loading',   TIMESTAMPTZ '2026-03-27 04:00:00+00'),
    ('SEED-CLR-2026-0002', 'BG TEST OCEAN 12', 'Unloading', TIMESTAMPTZ '2026-03-27 07:30:00+00'),
    ('SEED-CLR-2026-0003', 'MT HARBOR STAR',   'Loading',   TIMESTAMPTZ '2026-03-26 15:00:00+00'),
    ('SEED-CLR-2026-0004', 'BG MERIDIAN 77',   'Unloading', TIMESTAMPTZ '2026-03-26 22:00:00+00')
) AS v(reference_number, vessel_name, purpose, eta)
WHERE NOT EXISTS (
  SELECT 1
  FROM shipping_instructions si
  WHERE si.reference_number = v.reference_number
    AND si.deleted_at IS NULL
);

-- 2) Seed matching operations for clearance statuses.
--    Keep jetty_id nullable (allowed since migration 015) to avoid hard dependency
--    on specific local jetty master rows.
INSERT INTO operations (
  shipping_instruction_id,
  jetty_id,
  status,
  purpose,
  docking_start_time,
  estimated_completion_time,
  actual_completion_time,
  completion_percent,
  sequence,
  remark,
  eta,
  ta,
  etb,
  nor_tendered_at,
  nor_accepted_at,
  no_pkk,
  priority,
  hose_off_at,
  cast_off_at,
  clearance_document_url,
  vessel_photo_url,
  sailed_at,
  created_at,
  updated_at
)
SELECT
  si.id,
  NULL,
  v.status,
  si.purpose,
  v.docking_start_time,
  v.estimated_completion_time,
  v.actual_completion_time,
  v.completion_percent,
  v.sequence,
  'Seeded operation for clearance verification testing',
  v.eta,
  v.ta,
  v.etb,
  v.nor_tendered_at,
  v.nor_accepted_at,
  v.no_pkk,
  v.priority,
  v.hose_off_at,
  v.cast_off_at,
  v.clearance_document_url,
  v.vessel_photo_url,
  v.sailed_at,
  NOW(),
  NOW()
FROM (
  VALUES
    (
      'SEED-CLR-2026-0001', 'SIGNOFF_APPROVED', 100, 1,
      TIMESTAMPTZ '2026-03-27 02:30:00+00', TIMESTAMPTZ '2026-03-27 10:00:00+00', TIMESTAMPTZ '2026-03-27 09:50:00+00',
      TIMESTAMPTZ '2026-03-27 04:00:00+00', TIMESTAMPTZ '2026-03-27 03:40:00+00', TIMESTAMPTZ '2026-03-27 04:10:00+00',
      TIMESTAMPTZ '2026-03-27 03:20:00+00', TIMESTAMPTZ '2026-03-27 03:45:00+00',
      'PKK-CLR-0001', 'High',
      NULL::timestamptz, NULL::timestamptz, NULL::text, NULL::text, NULL::timestamptz
    ),
    (
      'SEED-CLR-2026-0002', 'SIGNOFF_APPROVED', 100, 2,
      TIMESTAMPTZ '2026-03-27 05:45:00+00', TIMESTAMPTZ '2026-03-27 14:00:00+00', TIMESTAMPTZ '2026-03-27 13:42:00+00',
      TIMESTAMPTZ '2026-03-27 07:30:00+00', TIMESTAMPTZ '2026-03-27 07:05:00+00', TIMESTAMPTZ '2026-03-27 07:35:00+00',
      TIMESTAMPTZ '2026-03-27 06:40:00+00', TIMESTAMPTZ '2026-03-27 07:10:00+00',
      'PKK-CLR-0002', 'Moderate',
      NULL::timestamptz, NULL::timestamptz, NULL::text, NULL::text, NULL::timestamptz
    ),
    (
      'SEED-CLR-2026-0003', 'SAILED', 100, 3,
      TIMESTAMPTZ '2026-03-26 11:00:00+00', TIMESTAMPTZ '2026-03-26 20:30:00+00', TIMESTAMPTZ '2026-03-26 20:10:00+00',
      TIMESTAMPTZ '2026-03-26 15:00:00+00', TIMESTAMPTZ '2026-03-26 14:40:00+00', TIMESTAMPTZ '2026-03-26 15:05:00+00',
      TIMESTAMPTZ '2026-03-26 14:20:00+00', TIMESTAMPTZ '2026-03-26 14:45:00+00',
      'PKK-CLR-0003', 'Low',
      TIMESTAMPTZ '2026-03-26 20:20:00+00', TIMESTAMPTZ '2026-03-26 20:35:00+00',
      '/uploads/operations/seed-clearance/clearance-0003.pdf',
      '/uploads/operations/seed-clearance/vessel-photo-0003.jpg',
      TIMESTAMPTZ '2026-03-26 20:35:00+00'
    ),
    (
      'SEED-CLR-2026-0004', 'SAILED', 100, 4,
      TIMESTAMPTZ '2026-03-26 18:20:00+00', TIMESTAMPTZ '2026-03-27 01:15:00+00', TIMESTAMPTZ '2026-03-27 00:55:00+00',
      TIMESTAMPTZ '2026-03-26 22:00:00+00', TIMESTAMPTZ '2026-03-26 21:40:00+00', TIMESTAMPTZ '2026-03-26 22:10:00+00',
      TIMESTAMPTZ '2026-03-26 21:20:00+00', TIMESTAMPTZ '2026-03-26 21:45:00+00',
      'PKK-CLR-0004', 'High',
      TIMESTAMPTZ '2026-03-27 01:05:00+00', TIMESTAMPTZ '2026-03-27 01:18:00+00',
      '/uploads/operations/seed-clearance/clearance-0004.pdf',
      '/uploads/operations/seed-clearance/vessel-photo-0004.jpg',
      TIMESTAMPTZ '2026-03-27 01:18:00+00'
    )
) AS v(
  reference_number, status, completion_percent, sequence,
  docking_start_time, estimated_completion_time, actual_completion_time,
  eta, ta, etb, nor_tendered_at, nor_accepted_at,
  no_pkk, priority,
  hose_off_at, cast_off_at, clearance_document_url, vessel_photo_url, sailed_at
)
JOIN shipping_instructions si
  ON si.reference_number = v.reference_number
 AND si.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM operations o
  WHERE o.shipping_instruction_id = si.id
    AND o.deleted_at IS NULL
);

-- 3) Seed operation_documents metadata for SAILED examples (optional evidence links).
INSERT INTO operation_documents (
  operation_id,
  kind,
  original_name,
  stored_name,
  stored_path,
  mime_type,
  size_bytes,
  created_at,
  updated_at
)
SELECT
  o.id,
  d.kind,
  d.original_name,
  d.stored_name,
  d.stored_path,
  d.mime_type,
  d.size_bytes,
  NOW(),
  NOW()
FROM (
  VALUES
    ('SEED-CLR-2026-0003', 'CLEARANCE',    'clearance-0003.pdf',    'clearance-0003.pdf',    'operations/seed-clearance/clearance-0003.pdf',    'application/pdf', 198420::bigint),
    ('SEED-CLR-2026-0003', 'VESSEL_PHOTO', 'vessel-photo-0003.jpg', 'vessel-photo-0003.jpg', 'operations/seed-clearance/vessel-photo-0003.jpg', 'image/jpeg',      325110::bigint),
    ('SEED-CLR-2026-0004', 'CLEARANCE',    'clearance-0004.pdf',    'clearance-0004.pdf',    'operations/seed-clearance/clearance-0004.pdf',    'application/pdf', 210205::bigint),
    ('SEED-CLR-2026-0004', 'VESSEL_PHOTO', 'vessel-photo-0004.jpg', 'vessel-photo-0004.jpg', 'operations/seed-clearance/vessel-photo-0004.jpg', 'image/jpeg',      342980::bigint)
) AS d(reference_number, kind, original_name, stored_name, stored_path, mime_type, size_bytes)
JOIN shipping_instructions si
  ON si.reference_number = d.reference_number
 AND si.deleted_at IS NULL
JOIN operations o
  ON o.shipping_instruction_id = si.id
 AND o.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM operation_documents od
  WHERE od.operation_id = o.id
    AND od.kind = d.kind
    AND od.stored_name = d.stored_name
    AND od.deleted_at IS NULL
);

COMMIT;
