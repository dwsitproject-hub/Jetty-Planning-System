-- Daily operational progress snapshots + port operational day start + load line hybrid fields.

BEGIN;

ALTER TABLE public.ports
  ADD COLUMN IF NOT EXISTS operational_day_start TIME NOT NULL DEFAULT '06:00:00';

COMMENT ON COLUMN public.ports.operational_day_start IS
  'Operational day start (HH:mm:ss in schedule_timezone). Default 06:00:00; day D runs D 06:00:00 → (D+1) 05:59:59.';

UPDATE public.ports
SET operational_day_start = '06:00:00'::time
WHERE operational_day_start IS DISTINCT FROM '06:00:00'::time;

ALTER TABLE public.operation_cargo_load_lines
  ADD COLUMN IF NOT EXISTS manual_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS atg_qty_mode TEXT NOT NULL DEFAULT 'auto';

ALTER TABLE public.operation_cargo_load_lines
  DROP CONSTRAINT IF EXISTS operation_cargo_load_lines_manual_qty_check;

ALTER TABLE public.operation_cargo_load_lines
  ADD CONSTRAINT operation_cargo_load_lines_manual_qty_check
  CHECK (manual_qty IS NULL OR manual_qty > 0);

ALTER TABLE public.operation_cargo_load_lines
  DROP CONSTRAINT IF EXISTS operation_cargo_load_lines_atg_qty_mode_check;

ALTER TABLE public.operation_cargo_load_lines
  ADD CONSTRAINT operation_cargo_load_lines_atg_qty_mode_check
  CHECK (atg_qty_mode IN ('auto', 'manual'));

COMMENT ON COLUMN public.operation_cargo_load_lines.manual_qty IS
  'Operator-entered qty for non-ATG tanks on mixed lines (or manual portion).';

COMMENT ON COLUMN public.operation_cargo_load_lines.atg_qty_mode IS
  'auto = use ATG when available; manual = force manual qty for this load line segment.';

CREATE TABLE IF NOT EXISTS public.operation_daily_cargo_progress (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  load_line_id BIGINT REFERENCES public.operation_cargo_load_lines(id) ON DELETE CASCADE,
  progress_date DATE NOT NULL,
  qty_moved NUMERIC NOT NULL DEFAULT 0 CHECK (qty_moved >= 0),
  source TEXT NOT NULL DEFAULT 'atg' CHECK (source IN ('atg', 'manual_fallback')),
  tank_detail JSONB,
  sample_window TSTZRANGE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_operation_daily_cargo_progress_line_date
    UNIQUE (operation_id, load_line_id, progress_date)
);

CREATE INDEX IF NOT EXISTS idx_odcp_operation_date
  ON public.operation_daily_cargo_progress (operation_id, progress_date);

COMMENT ON TABLE public.operation_daily_cargo_progress IS
  'Permanent daily ATG cargo progress snapshots (survives tank_gauging_samples purge).';

COMMIT;
