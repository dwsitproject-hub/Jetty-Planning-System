-- Reset transactional data (keep master tables) and seed fresh demo data.
-- Target: local docker DB (jps-db). Safe to re-run.

BEGIN;

-- ----------------------------
-- 1) Clean transactional tables
-- ----------------------------
TRUNCATE TABLE
  public.qc_documents,
  public.qc_surveys,
  public.quantity_checks,
  public.operation_documents,
  public.operation_operational_activities,
  public.operation_sub_process_documents,
  public.operation_sub_processes,
  public.operation_nor_details,
  public.operation_materials,
  public.operations,
  public.shipping_instruction_breakdown,
  public.shipping_instructions,
  public.activity_logs
RESTART IDENTITY CASCADE;

-- ----------------------------
-- 2) Seed Shipping Instructions + breakdown (fresh dates)
-- ----------------------------
-- Use a single port for dev (first port by id).
WITH port AS (
  SELECT id AS port_id FROM public.ports WHERE deleted_at IS NULL ORDER BY id LIMIT 1
),
mt_metric AS (
  SELECT id AS metric_id FROM public.metric WHERE UPPER(code) = 'MT' AND deleted_at IS NULL ORDER BY id LIMIT 1
),
commodities AS (
  SELECT
    (SELECT id FROM public.si_commodities WHERE LOWER(name) = 'cpo' AND deleted_at IS NULL LIMIT 1) AS cpo_id,
    (SELECT id FROM public.si_commodities WHERE LOWER(name) = 'pke' AND deleted_at IS NULL LIMIT 1) AS pke_id,
    (SELECT id FROM public.si_commodities WHERE LOWER(name) = 'pks' AND deleted_at IS NULL LIMIT 1) AS pks_id
),
ins AS (
  INSERT INTO public.shipping_instructions (
    reference_number, vessel_name, purpose, status,
    eta, eta_from, eta_to, note,
    port_id,
    created_at, updated_at
  )
  SELECT
    v.reference_number,
    v.vessel_name,
    v.purpose,
    v.status,
    v.eta,
    v.eta::date,
    (v.eta + INTERVAL '1 day')::date,
    v.note,
    p.port_id,
    NOW(),
    NOW()
  FROM port p
  JOIN (
    VALUES
      ('DEMO-SI-0001', 'MT DEMO LOADING 01',   'Loading',   'Approved',  NOW() + INTERVAL '6 hours',  'Incoming SI (no operation yet)'),
      ('DEMO-SI-0002', 'BG DEMO UNLOAD 02',    'Unloading', 'Approved',  NOW() + INTERVAL '10 hours', 'Incoming SI (no operation yet)'),
      ('DEMO-SI-0003', 'MT BERTHED DEMO 03',   'Loading',   'Approved',  NOW() - INTERVAL '2 hours',  'Has operation: DOCKED'),
      ('DEMO-SI-0004', 'BG INPROGRESS DEMO 04','Unloading', 'Approved',  NOW() - INTERVAL '6 hours',  'Has operation: IN_PROGRESS'),
      ('DEMO-SI-0005', 'MT READY SAIL 05',     'Loading',   'Approved',  NOW() - INTERVAL '14 hours', 'Has operation: SIGNOFF_APPROVED (clearance flow)'),
      ('DEMO-SI-0006', 'BG SAILED DEMO 06',    'Unloading', 'Approved',  NOW() - INTERVAL '30 hours', 'Has operation: SAILED (history)'),
      ('DEMO-SI-0007', 'MT MULTI CARGO 07',    'Loading',   'Approved',  NOW() + INTERVAL '18 hours', 'Multi-commodity breakdown')
  ) AS v(reference_number, vessel_name, purpose, status, eta, note)
    ON 1=1
  RETURNING id, reference_number
)
INSERT INTO public.shipping_instruction_breakdown (
  shipping_instruction_id, commodity_id, metric_id, qty,
  contract_no, po_no, remarks, line_order,
  created_at, updated_at
)
SELECT
  si.id,
  b.commodity_id,
  mt.metric_id,
  b.qty,
  b.contract_no,
  b.po_no,
  'Seeded breakdown',
  b.line_order,
  NOW(),
  NOW()
FROM ins si
CROSS JOIN mt_metric mt
CROSS JOIN commodities c
JOIN (
  VALUES
    ('DEMO-SI-0001', 1, (SELECT cpo_id FROM commodities), 2500::numeric, 'CTR-0001', 'PO-0001'),
    ('DEMO-SI-0002', 1, (SELECT pke_id FROM commodities), 4800::numeric, 'CTR-0002', 'PO-0002'),
    ('DEMO-SI-0003', 1, (SELECT cpo_id FROM commodities), 3200::numeric, 'CTR-0003', 'PO-0003'),
    ('DEMO-SI-0004', 1, (SELECT pks_id FROM commodities), 2900::numeric, 'CTR-0004', 'PO-0004'),
    ('DEMO-SI-0005', 1, (SELECT cpo_id FROM commodities), 1800::numeric, 'CTR-0005', 'PO-0005'),
    ('DEMO-SI-0006', 1, (SELECT pke_id FROM commodities), 2100::numeric, 'CTR-0006', 'PO-0006'),
    -- Multi-commodity: two lines
    ('DEMO-SI-0007', 1, (SELECT cpo_id FROM commodities), 1500::numeric, 'CTR-0007A', 'PO-0007A'),
    ('DEMO-SI-0007', 2, (SELECT pke_id FROM commodities), 900::numeric,  'CTR-0007B', 'PO-0007B')
 ) AS b(reference_number, line_order, commodity_id, qty, contract_no, po_no)
  ON b.reference_number = si.reference_number;

-- ----------------------------
-- 3) Seed operations for selected SIs (fresh dates)
-- ----------------------------
WITH port AS (
  SELECT id AS port_id FROM public.ports WHERE deleted_at IS NULL ORDER BY id LIMIT 1
),
jetty AS (
  SELECT id AS jetty_id, name FROM public.jetties WHERE deleted_at IS NULL ORDER BY id
),
si AS (
  SELECT id, reference_number, purpose
  FROM public.shipping_instructions
  WHERE deleted_at IS NULL
)
INSERT INTO public.operations (
  shipping_instruction_id, jetty_id, port_id,
  status, purpose,
  docking_start_time, estimated_completion_time, actual_completion_time,
  completion_percent, sequence, remark,
  eta, ta, etb, tb,
  nor_tendered_at, nor_accepted_at,
  no_pkk, priority,
  cast_off_at,
  clearance_document_url, vessel_photo_url,
  sailed_at,
  created_at, updated_at
)
SELECT
  si.id,
  j.jetty_id,
  p.port_id,
  v.status,
  si.purpose,
  v.tb,
  v.estimated_completion_time,
  v.actual_completion_time,
  v.completion_percent,
  v.sequence,
  'Seeded operation',
  v.eta,
  v.ta,
  v.etb,
  v.tb,
  v.nor_tendered_at,
  v.nor_accepted_at,
  v.no_pkk,
  v.priority,
  v.cast_off_at,
  v.clearance_document_url,
  v.vessel_photo_url,
  v.sailed_at,
  NOW(),
  NOW()
FROM port p
JOIN (
  VALUES
    ('DEMO-SI-0003', 1, 'DOCKED',      30, 1,
      NOW() - INTERVAL '1 hour', NOW() + INTERVAL '9 hours', NULL::timestamptz,
      NOW() - INTERVAL '2 hours', NOW() - INTERVAL '90 minutes', NOW() - INTERVAL '70 minutes',
      NOW() - INTERVAL '110 minutes', NOW() - INTERVAL '100 minutes',
      'PKK-DEMO-0003', 'Moderate',
      NULL::timestamptz, NULL::text, NULL::text, NULL::timestamptz
    ),
    ('DEMO-SI-0004', 2, 'IN_PROGRESS', 55, 2,
      NOW() - INTERVAL '4 hours', NOW() + INTERVAL '5 hours', NULL::timestamptz,
      NOW() - INTERVAL '6 hours', NOW() - INTERVAL '5 hours', NOW() - INTERVAL '4 hours',
      NOW() - INTERVAL '5 hours 20 minutes', NOW() - INTERVAL '5 hours 5 minutes',
      'PKK-DEMO-0004', 'High',
      NULL::timestamptz, NULL::text, NULL::text, NULL::timestamptz
    ),
    ('DEMO-SI-0005', 3, 'SIGNOFF_APPROVED',   100, 3,
      NOW() - INTERVAL '12 hours', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours 20 minutes',
      NOW() - INTERVAL '14 hours', NOW() - INTERVAL '13 hours 40 minutes', NOW() - INTERVAL '12 hours 50 minutes',
      NOW() - INTERVAL '13 hours 55 minutes', NOW() - INTERVAL '13 hours 35 minutes',
      'PKK-DEMO-0005', 'Low',
      NOW() - INTERVAL '1 hour',
      '/uploads/operations/seed-clearance/demo-clearance-0005.pdf',
      '/uploads/operations/seed-clearance/demo-vessel-0005.jpg',
      NULL::timestamptz
    ),
    ('DEMO-SI-0006', 4, 'SAILED',      100, 4,
      NOW() - INTERVAL '28 hours', NOW() - INTERVAL '20 hours', NOW() - INTERVAL '20 hours 10 minutes',
      NOW() - INTERVAL '30 hours', NOW() - INTERVAL '29 hours 30 minutes', NOW() - INTERVAL '28 hours 20 minutes',
      NOW() - INTERVAL '29 hours 40 minutes', NOW() - INTERVAL '29 hours 15 minutes',
      'PKK-DEMO-0006', 'High',
      NOW() - INTERVAL '19 hours 30 minutes',
      '/uploads/operations/seed-clearance/demo-clearance-0006.pdf',
      '/uploads/operations/seed-clearance/demo-vessel-0006.jpg',
      NOW() - INTERVAL '19 hours 30 minutes'
    )
  ) AS v(reference_number, jetty_ord, status, completion_percent, sequence,
         tb, estimated_completion_time, actual_completion_time,
         eta, ta, etb,
         nor_tendered_at, nor_accepted_at,
         no_pkk, priority,
         cast_off_at, clearance_document_url, vessel_photo_url, sailed_at)
  ON 1=1
JOIN si ON si.reference_number = v.reference_number
JOIN (
  SELECT id AS jetty_id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM public.jetties WHERE deleted_at IS NULL
) j ON j.rn = v.jetty_ord
WHERE NOT EXISTS (
  SELECT 1 FROM public.operations o WHERE o.deleted_at IS NULL AND o.shipping_instruction_id = si.id
);

-- Seed operation_materials for those operations (based on SI breakdown line 1 qty).
INSERT INTO public.operation_materials (operation_id, material_key, volume, created_at, updated_at)
SELECT
  o.id,
  UPPER(TRIM(COALESCE(sc.name, 'CPO'))),
  b.qty,
  NOW(),
  NOW()
FROM public.operations o
JOIN public.shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
JOIN public.shipping_instruction_breakdown b ON b.shipping_instruction_id = si.id AND b.deleted_at IS NULL AND b.line_order = 1
JOIN public.si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.operation_materials m
    WHERE m.deleted_at IS NULL AND m.operation_id = o.id
  );

-- Seed clearance docs metadata (matches Verification page expectations).
INSERT INTO public.operation_documents (
  operation_id, kind, original_name, stored_name, stored_path, mime_type, size_bytes, created_at, updated_at
)
SELECT
  o.id,
  'CLEARANCE',
  'clearance.pdf',
  'clearance.pdf',
  'operations/seed-clearance/clearance.pdf',
  'application/pdf',
  123456::bigint,
  NOW(),
  NOW()
FROM public.operations o
WHERE o.deleted_at IS NULL
  AND o.clearance_document_url IS NOT NULL;

COMMIT;

