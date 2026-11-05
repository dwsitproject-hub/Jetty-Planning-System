-- QC spec templates: which quality parameters a commodity card shows.
-- One template can be assigned to many active SKUs; each SKU has at most one template.

BEGIN;

CREATE TABLE IF NOT EXISTS public.qc_parameters (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  label_en TEXT NOT NULL,
  label_id TEXT NOT NULL,
  unit TEXT,
  kind TEXT NOT NULL DEFAULT 'number',
  max_value NUMERIC(10,3) NOT NULL DEFAULT 100,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT qc_parameters_kind_check CHECK (kind IN ('number', 'color_pair')),
  CONSTRAINT qc_parameters_max_check CHECK (max_value > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qc_parameters_code_active
  ON public.qc_parameters (LOWER(code)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.qc_spec_templates (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by BIGINT,
  updated_by BIGINT
);

CREATE TABLE IF NOT EXISTS public.qc_spec_template_items (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES public.qc_spec_templates(id) ON DELETE CASCADE,
  parameter_id BIGINT NOT NULL REFERENCES public.qc_parameters(id),
  sort_order INT NOT NULL DEFAULT 0,
  scope TEXT NOT NULL DEFAULT 'report',
  CONSTRAINT qc_spec_template_items_scope_check CHECK (scope IN ('report', 'sample', 'both')),
  CONSTRAINT qc_spec_template_items_unique UNIQUE (template_id, parameter_id)
);

CREATE TABLE IF NOT EXISTS public.qc_spec_assignments (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES public.qc_spec_templates(id) ON DELETE CASCADE,
  commodity_id BIGINT NOT NULL REFERENCES public.si_commodities(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qc_spec_assignments_commodity_active
  ON public.qc_spec_assignments (commodity_id) WHERE deleted_at IS NULL;

ALTER TABLE public.sampling_commodity_qc
  ADD COLUMN IF NOT EXISTS metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON TABLE public.qc_parameters IS 'Library of QC quality parameters (FFA, M&I, Color, ...).';
COMMENT ON TABLE public.qc_spec_templates IS 'Named field template shared by one or more commodities.';
COMMENT ON TABLE public.qc_spec_assignments IS 'One active assignment per commodity; many commodities per template.';
COMMENT ON COLUMN public.sampling_commodity_qc.metrics_json IS
  'Stated report values keyed by parameter code. Typed columns stay in sync for FFA/M&I/DOBI/IV.';

INSERT INTO public.qc_parameters (code, label_en, label_id, unit, kind, max_value, sort_order)
SELECT v.code, v.label_en, v.label_id, v.unit, v.kind, v.max_value, v.sort_order
FROM (VALUES
  ('ffa', 'FFA', 'FFA', '%', 'number', 100, 10),
  ('mi', 'M&I', 'M&I', '%', 'number', 100, 20),
  ('moisture', 'Moisture', 'Moisture', '%', 'number', 100, 25),
  ('dobi', 'DOBI', 'DOBI', NULL, 'number', 100, 30),
  ('iodine', 'IV', 'IV', 'gI2/100g', 'number', 200, 40),
  ('color', 'Color (Red/Yellow)', 'Warna (Merah/Kuning)', NULL, 'color_pair', 1000, 50),
  ('melting_point', 'Melting Point', 'Titik Leleh', '°C', 'number', 200, 60),
  ('cloud_point', 'Cloud Point', 'Titik Awan', '°C', 'number', 200, 70),
  ('mcpd', '3-MCPD', '3-MCPD', 'mg/kg', 'number', 10000, 80),
  ('glycidol', 'Glycidol Ester', 'Glisidol Ester', 'mg/kg', 'number', 10000, 90),
  ('sulphur', 'Sulphur', 'Sulfur', 'mg/kg', 'number', 10000, 100),
  ('phosphorus', 'Phosphorus', 'Fosfor', 'mg/kg', 'number', 10000, 110),
  ('total_metal', 'Total Metal Content', 'Kandungan Logam Total', 'mg/kg', 'number', 10000, 120),
  ('chloride', 'Chloride', 'Klorida', 'mg/kg', 'number', 10000, 130),
  ('unsaponifiable', 'Unsaponifiable matter', 'Zat tak tersabunkan', '%', 'number', 100, 140),
  ('tfm', 'TFM', 'TFM', '%', 'number', 100, 150),
  ('ester', 'Ester', 'Ester', '%', 'number', 100, 160),
  ('dirt', 'Dirt', 'Kotoran', '%', 'number', 100, 170)
) AS v(code, label_en, label_id, unit, kind, max_value, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.qc_parameters p WHERE p.deleted_at IS NULL AND LOWER(p.code) = LOWER(v.code)
);

-- Seed named templates (assignments only when the SKU exists and is active).
INSERT INTO public.qc_spec_templates (name)
SELECT name FROM (VALUES ('CPO'), ('RBD refined'), ('RPOME'), ('PFAD'), ('Cangkang')) AS t(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.qc_spec_templates x WHERE x.deleted_at IS NULL AND x.name = t.name
);

INSERT INTO public.qc_spec_template_items (template_id, parameter_id, sort_order, scope)
SELECT t.id, p.id, x.sort_order, x.scope
FROM public.qc_spec_templates t
JOIN (VALUES
  ('CPO', 'ffa', 10, 'both'),
  ('CPO', 'mi', 20, 'both'),
  ('CPO', 'dobi', 30, 'report'),
  ('RBD refined', 'ffa', 10, 'report'),
  ('RBD refined', 'mi', 20, 'report'),
  ('RBD refined', 'color', 30, 'report'),
  ('RBD refined', 'iodine', 40, 'report'),
  ('RBD refined', 'melting_point', 50, 'report'),
  ('RBD refined', 'mcpd', 60, 'report'),
  ('RBD refined', 'glycidol', 70, 'report'),
  ('RPOME', 'ffa', 10, 'report'),
  ('RPOME', 'mi', 20, 'report'),
  ('RPOME', 'iodine', 30, 'report'),
  ('RPOME', 'sulphur', 40, 'report'),
  ('RPOME', 'phosphorus', 50, 'report'),
  ('RPOME', 'total_metal', 60, 'report'),
  ('RPOME', 'chloride', 70, 'report'),
  ('RPOME', 'unsaponifiable', 80, 'report'),
  ('PFAD', 'ffa', 10, 'report'),
  ('PFAD', 'mi', 20, 'report'),
  ('PFAD', 'tfm', 30, 'report'),
  ('PFAD', 'unsaponifiable', 40, 'report'),
  ('PFAD', 'ester', 50, 'report'),
  ('Cangkang', 'moisture', 10, 'both'),
  ('Cangkang', 'dirt', 20, 'both')
) AS x(template_name, code, sort_order, scope)
  ON x.template_name = t.name
JOIN public.qc_parameters p ON LOWER(p.code) = LOWER(x.code) AND p.deleted_at IS NULL
WHERE t.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.qc_spec_template_items i
    WHERE i.template_id = t.id AND i.parameter_id = p.id
  );

INSERT INTO public.qc_spec_assignments (template_id, commodity_id)
SELECT t.id, c.id
FROM public.qc_spec_templates t
JOIN public.si_commodities c ON c.deleted_at IS NULL AND COALESCE(c.is_active, TRUE)
JOIN (VALUES
  ('CPO', 'CPO'),
  ('RBD refined', 'RPO'),
  ('RBD refined', 'RBDPS'),
  ('RPOME', 'RPOME'),
  ('PFAD', 'PFAD'),
  ('Cangkang', 'PKS'),
  ('Cangkang', 'SHELL PALM')
) AS x(template_name, short_name)
  ON t.name = x.template_name AND UPPER(TRIM(c.short_name)) = x.short_name
WHERE t.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.qc_spec_assignments a
    WHERE a.commodity_id = c.id AND a.deleted_at IS NULL
  );

INSERT INTO public.permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'master-qc-spec', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM public.permissions p
  WHERE p.deleted_at IS NULL AND p.resource_type = 'page' AND p.resource_key = 'master-qc-spec'
);

INSERT INTO public.role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT r.id, p.id, TRUE, TRUE, TRUE, FALSE, NOW()
FROM public.roles r
JOIN public.permissions p
  ON p.deleted_at IS NULL AND p.resource_type = 'page' AND p.resource_key = 'master-qc-spec'
WHERE r.deleted_at IS NULL
  AND r.name IN ('JPS Full Access', 'Admin')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions x
    WHERE x.role_id = r.id AND x.permission_id = p.id AND x.deleted_at IS NULL
  );

-- Anyone who can edit Master Commodity can maintain QC specs.
INSERT INTO public.role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT rp.role_id, p_new.id, rp.can_view, rp.can_edit, rp.can_delete, COALESCE(rp.can_approve, FALSE), NOW()
FROM public.role_permissions rp
JOIN public.permissions p_src
  ON p_src.id = rp.permission_id AND p_src.deleted_at IS NULL
 AND p_src.resource_type = 'page' AND p_src.resource_key = 'master-si-commodity'
JOIN public.permissions p_new
  ON p_new.deleted_at IS NULL AND p_new.resource_type = 'page' AND p_new.resource_key = 'master-qc-spec'
WHERE rp.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions x
    WHERE x.role_id = rp.role_id AND x.permission_id = p_new.id AND x.deleted_at IS NULL
  );

COMMIT;
