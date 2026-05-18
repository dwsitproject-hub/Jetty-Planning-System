-- Rollback 075: restore as_of_at from ended_at; drop segment columns.

BEGIN;

ALTER TABLE public.operation_cargo_load_lines
  DROP CONSTRAINT IF EXISTS operation_cargo_load_lines_segment_positive;

ALTER TABLE public.operation_cargo_load_lines
  ADD COLUMN IF NOT EXISTS as_of_at TIMESTAMPTZ;

UPDATE public.operation_cargo_load_lines
SET as_of_at = ended_at
WHERE as_of_at IS NULL;

ALTER TABLE public.operation_cargo_load_lines
  ALTER COLUMN as_of_at SET NOT NULL;

ALTER TABLE public.operation_cargo_load_lines
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS ended_at;

COMMENT ON TABLE public.operation_cargo_load_lines IS
  'Per-line qty + as-of time for cargo_operations activities (incremental loading rate).';

COMMIT;
