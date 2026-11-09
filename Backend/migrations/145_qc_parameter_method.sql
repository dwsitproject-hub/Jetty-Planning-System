-- Unit stays on qc_parameters; Method is stored separately so CoA export can print both.
-- Do not fold unit into the label.

BEGIN;

ALTER TABLE public.qc_parameters
  ADD COLUMN IF NOT EXISTS method TEXT;

COMMENT ON COLUMN public.qc_parameters.unit IS 'Result unit printed as its own CoA column (%, °C, mg/kg, R/Y).';
COMMENT ON COLUMN public.qc_parameters.method IS 'Test method printed as its own CoA column (e.g. AOCS Ca 5a-40).';

-- Color used to bury R/Y in the label; unit is now its own field.
UPDATE public.qc_parameters
SET unit = 'R/Y',
    label_en = 'Color',
    label_id = 'Warna',
    updated_at = NOW()
WHERE deleted_at IS NULL
  AND LOWER(code) = 'color'
  AND (
    unit IS NULL
    OR TRIM(unit) = ''
    OR label_en = 'Color (Red/Yellow)'
  );

UPDATE public.qc_parameters AS p
SET method = v.method,
    updated_at = NOW()
FROM (VALUES
  ('ffa', 'AOCS Ca 5a-40'),
  ('mi', 'AOCS Ca 2c-25'),
  ('moisture', 'AOCS Ca 2c-25'),
  ('color', 'AOCS Cc 13e-92'),
  ('iodine', 'AOCS Cd 1-25'),
  ('melting_point', 'AOCS Cc 3-25'),
  ('cloud_point', 'AOCS Cc 6-25'),
  ('mcpd', 'AOCS Cd 29a-13'),
  ('glycidol', 'AOCS Cd 29a-13')
) AS v(code, method)
WHERE p.deleted_at IS NULL
  AND LOWER(p.code) = LOWER(v.code)
  AND (p.method IS NULL OR TRIM(p.method) = '');

COMMIT;
