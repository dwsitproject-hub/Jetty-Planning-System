-- Reset transactional data (keep master tables) and seed fresh demo data.
-- Target: local docker DB (jps-db). Safe to re-run.
-- Cleanup only (no seed): Backend/scripts/purge-transactional-data.sql

BEGIN;

-- ----------------------------
-- 1) Clean transactional tables
-- ----------------------------
TRUNCATE TABLE
  public.notification_deliveries,
  public.notifications,
  public.qc_documents,
  public.qc_surveys,
  public.quantity_checks,
  public.operation_cargo_load_lines,
  public.operation_operational_activities,
  public.operation_sub_process_documents,
  public.operation_sub_processes,
  public.operation_nor_details,
  public.operation_documents,
  public.operation_materials,
  public.jetty_operation_code_counters,
  public.operations,
  public.shipping_instruction_documents,
  public.shipping_instruction_breakdown,
  public.shipping_instructions,
  public.shipment_plans,
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
plan_ins AS (
  INSERT INTO public.shipment_plans (
    port_id, vessel_name, approval_status, plan_reference,
    purpose_id, voyage_no, eta,
    created_at, updated_at
  )
  SELECT
    p.port_id,
    pv.vessel_name,
    'Approved',
    'SP-SEED-' || pv.ord::text,
    (SELECT id FROM public.si_purposes WHERE code = CASE WHEN pv.ord IN (2, 4, 6) THEN 'Unloading' ELSE 'Loading' END AND deleted_at IS NULL LIMIT 1),
    'V-SEED-' || pv.ord::text,
    NOW() + (pv.ord::text || ' hours')::interval,
    NOW(),
    NOW()
  FROM port p
  CROSS JOIN (
    VALUES
      (1, 'MT DEMO LOADING 01'),
      (2, 'BG DEMO UNLOAD 02'),
      (3, 'MT BERTHED DEMO 03'),
      (4, 'BG INPROGRESS DEMO 04'),
      (5, 'MT READY SAIL 05'),
      (6, 'BG SAILED DEMO 06'),
      (7, 'MT MULTI CARGO 07')
  ) AS pv(ord, vessel_name)
  RETURNING id, vessel_name
),
ins AS (
  INSERT INTO public.shipping_instructions (
    reference_number, status,
    eta_from, eta_to, note,
    shipment_plan_id,
    created_at, updated_at
  )
  SELECT
    v.reference_number,
    v.status,
    v.eta::date,
    (v.eta + INTERVAL '1 day')::date,
    v.note,
    pr.id,
    NOW(),
    NOW()
  FROM (
    VALUES
      ('DEMO-SI-0001', 'MT DEMO LOADING 01',   'Approved',  NOW() + INTERVAL '6 hours',  'Incoming SI (no operation yet)'),
      ('DEMO-SI-0002', 'BG DEMO UNLOAD 02',    'Approved',  NOW() + INTERVAL '10 hours', 'Incoming SI (no operation yet)'),
      ('DEMO-SI-0003', 'MT BERTHED DEMO 03',   'Approved',  NOW() - INTERVAL '2 hours',  'Has operation: DOCKED'),
      ('DEMO-SI-0004', 'BG INPROGRESS DEMO 04','Approved',  NOW() - INTERVAL '6 hours',  'Has operation: IN_PROGRESS'),
      ('DEMO-SI-0005', 'MT READY SAIL 05',     'Approved',  NOW() - INTERVAL '14 hours', 'Has operation: SIGNOFF_APPROVED (clearance flow)'),
      ('DEMO-SI-0006', 'BG SAILED DEMO 06',    'Approved',  NOW() - INTERVAL '30 hours', 'Has operation: SAILED (history)'),
      ('DEMO-SI-0007', 'MT MULTI CARGO 07',    'Approved',  NOW() + INTERVAL '18 hours', 'Multi-commodity breakdown')
  ) AS v(reference_number, plan_vessel_key, status, eta, note)
    ON 1=1
  JOIN plan_ins pr ON pr.vessel_name = v.plan_vessel_key
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

-- Second SI on the same shipment plan as DEMO-SI-0005 (multi-SI / clearance regression).
INSERT INTO public.shipping_instructions (
  reference_number, status,
  eta_from, eta_to, note,
  shipment_plan_id,
  created_at, updated_at
)
SELECT
  'DEMO-SI-0005-B',
  si.status,
  si.eta_from,
  si.eta_to,
  'Second SI on same plan (multi-SI vessel call)',
  si.shipment_plan_id,
  NOW(),
  NOW()
FROM public.shipping_instructions si
WHERE si.reference_number = 'DEMO-SI-0005' AND si.deleted_at IS NULL
LIMIT 1;

INSERT INTO public.shipping_instruction_breakdown (
  shipping_instruction_id, commodity_id, metric_id, qty,
  contract_no, po_no, remarks, line_order,
  created_at, updated_at
)
SELECT
  si2.id,
  b.commodity_id,
  b.metric_id,
  b.qty * 0.5,
  b.contract_no || '-B',
  b.po_no || '-B',
  'Seeded breakdown (sibling SI)',
  1,
  NOW(),
  NOW()
FROM public.shipping_instructions si2
JOIN public.shipping_instructions si1 ON si1.reference_number = 'DEMO-SI-0005' AND si1.deleted_at IS NULL
JOIN public.shipping_instruction_breakdown b ON b.shipping_instruction_id = si1.id AND b.deleted_at IS NULL AND b.line_order = 1
WHERE si2.reference_number = 'DEMO-SI-0005-B' AND si2.deleted_at IS NULL;

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
  SELECT si.id, si.reference_number, spp.code AS purpose
  FROM public.shipping_instructions si
  JOIN public.shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
  LEFT JOIN public.si_purposes spp ON spp.id = sp.purpose_id AND spp.deleted_at IS NULL
  WHERE si.deleted_at IS NULL
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
    ('DEMO-SI-0005-B', 3, 'SIGNOFF_APPROVED',   100, 3,
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

-- Keep shipment_plans in sync with seeded operations (vessel-level allocation mirror).
UPDATE public.shipment_plans sp
SET
  jetty_id = o.jetty_id,
  sequence = o.sequence,
  remark = COALESCE(o.remark, sp.remark),
  priority = o.priority,
  no_pkk = o.no_pkk,
  eta = o.eta,
  ta = o.ta,
  etb = o.etb,
  pob = o.pob,
  tb = o.tb,
  sob = o.sob,
  docking_start_time = o.docking_start_time,
  estimated_completion_time = o.estimated_completion_time,
  actual_completion_time = o.actual_completion_time,
  nor_tendered_at = o.nor_tendered_at,
  nor_accepted_at = o.nor_accepted_at,
  demurrage_liability_from_at = o.demurrage_liability_from_at,
  shifting_out = o.shifting_out,
  shifting_out_at = o.shifting_out_at,
  sailed_at = o.sailed_at,
  cast_off_at = o.cast_off_at,
  clearance_document_url = o.clearance_document_url,
  vessel_photo_url = o.vessel_photo_url,
  updated_at = NOW()
FROM public.shipping_instructions si
JOIN public.operations o ON o.shipping_instruction_id = si.id AND o.deleted_at IS NULL
WHERE sp.id = si.shipment_plan_id;

-- Incoming-only SIs: copy planned ETA from SI onto the plan shell.
UPDATE public.shipment_plans sp
SET
  eta = COALESCE(sp.eta, si.eta_to::timestamptz, si.eta_from::timestamptz),
  updated_at = NOW()
FROM public.shipping_instructions si
WHERE sp.id = si.shipment_plan_id
  AND NOT EXISTS (
    SELECT 1 FROM public.operations o
    WHERE o.shipping_instruction_id = si.id AND o.deleted_at IS NULL
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

-- Assign Jetty Operation Id for seeded rows (requires migration 056 + assign_jetty_operation_code).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.operations WHERE deleted_at IS NULL AND jetty_operation_code IS NULL ORDER BY id
  LOOP
    PERFORM public.assign_jetty_operation_code(r.id, 'Asia/Jakarta');
  END LOOP;
END $$;

COMMIT;

