BEGIN;

DROP INDEX IF EXISTS idx_operation_cargo_load_lines_one_open;

ALTER TABLE public.operation_cargo_load_lines
  DROP COLUMN IF EXISTS atg_mass_computed_at,
  DROP COLUMN IF EXISTS atg_mass_detail,
  DROP COLUMN IF EXISTS atg_mass_delta;

ALTER TABLE public.operation_cargo_load_lines
  DROP CONSTRAINT IF EXISTS operation_cargo_load_lines_qty_check;

ALTER TABLE public.operation_cargo_load_lines
  ADD CONSTRAINT operation_cargo_load_lines_qty_check CHECK (qty > 0);

UPDATE public.operation_cargo_load_lines
SET ended_at = started_at + INTERVAL '1 second'
WHERE ended_at IS NULL;

UPDATE public.operation_cargo_load_lines
SET qty = 1
WHERE qty IS NULL;

ALTER TABLE public.operation_cargo_load_lines
  ALTER COLUMN qty SET NOT NULL,
  ALTER COLUMN ended_at SET NOT NULL;

ALTER TABLE public.operation_cargo_load_lines
  DROP CONSTRAINT IF EXISTS operation_cargo_load_lines_segment_positive;

ALTER TABLE public.operation_cargo_load_lines
  ADD CONSTRAINT operation_cargo_load_lines_segment_positive
  CHECK (ended_at > started_at);

COMMIT;
