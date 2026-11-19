-- No-flow (downtime) log: why cargo stopped flowing during a voyage.
-- Reasons are a shared master (all ports). Stops are stored per voyage by time window,
-- not per cargo entry, because entries are re-created on every save.

BEGIN;

CREATE TABLE IF NOT EXISTS public.master_no_flow_reasons (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('terminal', 'vessel', 'external', 'other')),
  requires_note BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_no_flow_reasons_code
  ON public.master_no_flow_reasons (UPPER(code))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.operation_no_flow_events (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL CHECK (ended_at > started_at),
  reason_id BIGINT NOT NULL REFERENCES public.master_no_flow_reasons(id),
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('atg_flat', 'gap', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_operation_no_flow_events_operation
  ON public.operation_no_flow_events (operation_id, started_at)
  WHERE deleted_at IS NULL;

ALTER TABLE public.ports
  ADD COLUMN IF NOT EXISTS no_flow_min_minutes INT NOT NULL DEFAULT 60
    CHECK (no_flow_min_minutes BETWEEN 5 AND 1440);

COMMENT ON COLUMN public.ports.no_flow_min_minutes IS
  'Stops shorter than this (minutes) are not flagged as needing a no-flow reason.';

INSERT INTO public.master_no_flow_reasons (code, name_en, name_id, category, requires_note, sort_order)
SELECT v.code, v.name_en, v.name_id, v.category, v.requires_note, v.sort_order
FROM (VALUES
  ('WX',  'Rain / weather',            'Hujan / cuaca',              'external', FALSE, 10),
  ('TSW', 'Tank switch',               'Pindah tangki',              'terminal', FALSE, 20),
  ('PMS', 'Pump trouble – shore',      'Pompa darat bermasalah',     'terminal', FALSE, 30),
  ('LFL', 'Line flushing / clearing',  'Flushing / pembersihan line', 'terminal', FALSE, 40),
  ('PWR', 'Power outage',              'Listrik padam',              'terminal', FALSE, 50),
  ('PMV', 'Pump trouble – vessel',     'Pompa kapal bermasalah',     'vessel',   FALSE, 60),
  ('BLS', 'Ballast / deballast',       'Ballast / deballast',        'vessel',   FALSE, 70),
  ('KRS', 'Kuras / stripping',         'Kuras',                      'vessel',   FALSE, 80),
  ('QCW', 'Waiting QC / sampling',     'Menunggu QC / sampling',     'external', FALSE, 90),
  ('DOC', 'Waiting document',          'Menunggu dokumen',           'external', FALSE, 100),
  ('CGO', 'Waiting cargo availability','Menunggu ketersediaan kargo', 'external', FALSE, 110),
  ('SHF', 'Shift change',              'Pergantian shift',           'terminal', FALSE, 120),
  ('OTH', 'Others',                    'Lainnya',                    'other',    TRUE,  999)
) AS v(code, name_en, name_id, category, requires_note, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.master_no_flow_reasons r WHERE UPPER(r.code) = v.code AND r.deleted_at IS NULL
);

INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'master-no-flow-reasons', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL AND p.resource_type = 'page' AND p.resource_key = 'master-no-flow-reasons'
);

-- Mirror master-tanks grants onto master-no-flow-reasons.
INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT rp.role_id, p_new.id, rp.can_view, rp.can_edit, rp.can_delete, COALESCE(rp.can_approve, FALSE), NOW()
FROM role_permissions rp
JOIN permissions p_src
  ON p_src.id = rp.permission_id AND p_src.deleted_at IS NULL
 AND p_src.resource_type = 'page' AND p_src.resource_key = 'master-tanks'
JOIN permissions p_new
  ON p_new.deleted_at IS NULL AND p_new.resource_type = 'page' AND p_new.resource_key = 'master-no-flow-reasons'
WHERE rp.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = rp.role_id AND x.permission_id = p_new.id AND x.deleted_at IS NULL
  );

INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT r.id, p.id, TRUE, TRUE, TRUE, TRUE, NOW()
FROM roles r
JOIN permissions p
  ON p.deleted_at IS NULL AND p.resource_type = 'page' AND p.resource_key = 'master-no-flow-reasons'
WHERE r.deleted_at IS NULL
  AND r.name = 'JPS Full Access'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = r.id AND x.permission_id = p.id AND x.deleted_at IS NULL
  );

COMMIT;
