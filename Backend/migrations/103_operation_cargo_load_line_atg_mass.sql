-- Open load segments (nullable end/qty) + per-line ATG mass delta snapshot for reconciliation.

BEGIN;

ALTER TABLE public.operation_cargo_load_lines
  ALTER COLUMN ended_at DROP NOT NULL;

ALTER TABLE public.operation_cargo_load_lines
  ALTER COLUMN qty DROP NOT NULL;

ALTER TABLE public.operation_cargo_load_lines
  DROP CONSTRAINT IF EXISTS operation_cargo_load_lines_segment_positive;

ALTER TABLE public.operation_cargo_load_lines
  ADD CONSTRAINT operation_cargo_load_lines_segment_positive
  CHECK (ended_at IS NULL OR ended_at > started_at);

ALTER TABLE public.operation_cargo_load_lines
  DROP CONSTRAINT IF EXISTS operation_cargo_load_lines_qty_check;

ALTER TABLE public.operation_cargo_load_lines
  ADD CONSTRAINT operation_cargo_load_lines_qty_check
  CHECK (qty IS NULL OR qty > 0);

ALTER TABLE public.operation_cargo_load_lines
  ADD COLUMN IF NOT EXISTS atg_mass_delta NUMERIC,
  ADD COLUMN IF NOT EXISTS atg_mass_detail JSONB,
  ADD COLUMN IF NOT EXISTS atg_mass_computed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_cargo_load_lines_one_open
  ON public.operation_cargo_load_lines (operational_activity_id)
  WHERE ended_at IS NULL;

COMMENT ON COLUMN public.operation_cargo_load_lines.atg_mass_delta IS
  'ATG sum of |Δmass| per selected tank over [started_at, ended_at or save time]; reconcile vs qty.';

COMMIT;
