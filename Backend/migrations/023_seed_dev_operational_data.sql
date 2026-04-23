-- Jetty Planning System - Migration 023
-- Dev seed: baseline operational data for local testing after fresh Docker/DB setup.

BEGIN;

-- Seed 3 Shipping Instructions (idempotent).
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
  v.eta_from,
  v.eta_to,
  v.note,
  NOW(),
  NOW()
FROM (
  VALUES
    ('SEED-SI-2026-0001', 'SPOB ANUGERAH BERSAM', 'Loading',   TIMESTAMPTZ '2026-03-24 08:00:00+00', DATE '2026-03-24', DATE '2026-03-25', 'Seed data for local testing'),
    ('SEED-SI-2026-0002', 'BG AS MARINA 10',      'Unloading', TIMESTAMPTZ '2026-03-24 13:00:00+00', DATE '2026-03-24', DATE '2026-03-26', 'Seed data for local testing'),
    ('SEED-SI-2026-0003', 'MT ROMEO P',           'Unloading', TIMESTAMPTZ '2026-03-25 03:00:00+00', DATE '2026-03-25', DATE '2026-03-27', 'Seed data for local testing')
) AS v(reference_number, vessel_name, purpose, eta, eta_from, eta_to, note)
WHERE NOT EXISTS (
  SELECT 1
  FROM shipping_instructions si
  WHERE si.reference_number = v.reference_number
    AND si.deleted_at IS NULL
);

-- Ensure each seeded SI has one breakdown row.
INSERT INTO shipping_instruction_breakdown (
  shipping_instruction_id,
  commodity_id,
  metric_id,
  qty,
  contract_no,
  po_no,
  remarks,
  line_order,
  created_at,
  updated_at
)
SELECT
  si.id,
  COALESCE(
    (SELECT id FROM si_commodities WHERE LOWER(name) = 'cpo' AND deleted_at IS NULL LIMIT 1),
    (SELECT id FROM si_commodities WHERE deleted_at IS NULL ORDER BY sort_order, id LIMIT 1)
  ) AS commodity_id,
  (SELECT id FROM metric WHERE UPPER(code) = 'MT' AND deleted_at IS NULL ORDER BY id LIMIT 1) AS metric_id,
  v.qty,
  v.contract_no,
  v.po_no,
  'Seeded breakdown',
  1,
  NOW(),
  NOW()
FROM (
  VALUES
    ('SEED-SI-2026-0001', 2500::numeric, 'CTR-SEED-0001', 'PO-SEED-0001'),
    ('SEED-SI-2026-0002', 4800::numeric, 'CTR-SEED-0002', 'PO-SEED-0002'),
    ('SEED-SI-2026-0003', 3000::numeric, 'CTR-SEED-0003', 'PO-SEED-0003')
) AS v(reference_number, qty, contract_no, po_no)
JOIN shipping_instructions si
  ON si.reference_number = v.reference_number
 AND si.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM shipping_instruction_breakdown b
  WHERE b.shipping_instruction_id = si.id
    AND b.deleted_at IS NULL
);

-- Seed matching Operations (idempotent), mapped to available jetties.
INSERT INTO operations (
  shipping_instruction_id,
  jetty_id,
  status,
  purpose,
  docking_start_time,
  estimated_completion_time,
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
  created_at,
  updated_at
)
SELECT
  si.id,
  j.id,
  v.status,
  si.purpose,
  v.docking_start_time,
  v.estimated_completion_time,
  v.completion_percent,
  v.sequence,
  'Seeded operation',
  v.eta,
  v.ta,
  v.etb,
  v.nor_tendered_at,
  v.nor_accepted_at,
  v.no_pkk,
  v.priority,
  NOW(),
  NOW()
FROM (
  VALUES
    ('SEED-SI-2026-0001', 'Jetty 3A', 'IN_PROGRESS', 50, 1, TIMESTAMPTZ '2026-03-24 07:30:00+00', TIMESTAMPTZ '2026-03-24 19:30:00+00', TIMESTAMPTZ '2026-03-24 08:00:00+00', TIMESTAMPTZ '2026-03-24 07:20:00+00', TIMESTAMPTZ '2026-03-24 07:45:00+00', TIMESTAMPTZ '2026-03-24 07:10:00+00', TIMESTAMPTZ '2026-03-24 07:25:00+00', 'PKK-SEED-0001', 'High'),
    ('SEED-SI-2026-0002', 'Jetty 1A', 'DOCKED',      30, 2, TIMESTAMPTZ '2026-03-24 12:00:00+00', TIMESTAMPTZ '2026-03-25 04:00:00+00', TIMESTAMPTZ '2026-03-24 13:00:00+00', TIMESTAMPTZ '2026-03-24 11:45:00+00', TIMESTAMPTZ '2026-03-24 12:10:00+00', TIMESTAMPTZ '2026-03-24 11:20:00+00', TIMESTAMPTZ '2026-03-24 11:55:00+00', 'PKK-SEED-0002', 'Moderate'),
    ('SEED-SI-2026-0003', 'Jetty 1B', 'ALLOCATED',    0, 3, NULL,                                   TIMESTAMPTZ '2026-03-25 18:00:00+00', TIMESTAMPTZ '2026-03-25 03:00:00+00', NULL,                                   NULL,                                   NULL,                                   NULL,                                   'PKK-SEED-0003', 'Low')
) AS v(reference_number, jetty_name, status, completion_percent, sequence, docking_start_time, estimated_completion_time, eta, ta, etb, nor_tendered_at, nor_accepted_at, no_pkk, priority)
JOIN shipping_instructions si
  ON si.reference_number = v.reference_number
 AND si.deleted_at IS NULL
LEFT JOIN jetties j
  ON j.name = v.jetty_name
 AND j.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM operations o
  WHERE o.shipping_instruction_id = si.id
    AND o.deleted_at IS NULL
);

-- Seed materials for seeded operations (idempotent).
INSERT INTO operation_materials (
  operation_id,
  material_key,
  volume,
  created_at,
  updated_at
)
SELECT
  o.id,
  v.material_key,
  v.volume,
  NOW(),
  NOW()
FROM (
  VALUES
    ('SEED-SI-2026-0001', 'CPO',   2500::numeric),
    ('SEED-SI-2026-0002', 'POME',  4800::numeric),
    ('SEED-SI-2026-0003', 'SRPKFA', 3000::numeric)
) AS v(reference_number, material_key, volume)
JOIN shipping_instructions si
  ON si.reference_number = v.reference_number
 AND si.deleted_at IS NULL
JOIN operations o
  ON o.shipping_instruction_id = si.id
 AND o.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM operation_materials m
  WHERE m.operation_id = o.id
    AND m.material_key = v.material_key
    AND m.deleted_at IS NULL
);

COMMIT;
