-- Hourly ATG cargo progress persistence, port flat-movement thresholds, manual checkpoints.
-- Note: no BEGIN/COMMIT here — run-migrations.js wraps each file in a transaction.

ALTER TABLE public.ports
  ADD COLUMN IF NOT EXISTS atg_flat_rate_threshold_tph NUMERIC NOT NULL DEFAULT 2.0;

ALTER TABLE public.ports
  ADD COLUMN IF NOT EXISTS atg_min_qty_moved_t NUMERIC NOT NULL DEFAULT 1.0;

COMMENT ON COLUMN public.ports.atg_flat_rate_threshold_tph IS
  'Hours with rate below this threshold (t/h) are labeled Flat Movement in hourly cargo progress.';

COMMENT ON COLUMN public.ports.atg_min_qty_moved_t IS
  'Minimum moved qty (t) in a clock hour to count as active transfer (ignore sensor noise).';

ALTER TABLE public.operation_cargo_load_lines
  ADD COLUMN IF NOT EXISTS atg_hourly_detail JSONB,
  ADD COLUMN IF NOT EXISTS atg_hourly_computed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.operation_cargo_load_lines.atg_hourly_detail IS
  'Snapshot of hourly bucket breakdown when segment closes (avoids re-walk after sample purge).';

CREATE TABLE IF NOT EXISTS public.operation_hourly_cargo_progress (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  load_line_id BIGINT NOT NULL REFERENCES public.operation_cargo_load_lines(id) ON DELETE CASCADE,
  hour_start TIMESTAMPTZ NOT NULL,
  hour_end TIMESTAMPTZ NOT NULL,
  qty_moved NUMERIC NOT NULL DEFAULT 0 CHECK (qty_moved >= 0),
  rate_tph NUMERIC,
  movement_status TEXT NOT NULL CHECK (movement_status IN ('active', 'flat_movement', 'incomplete')),
  source TEXT NOT NULL CHECK (source IN ('atg', 'manual', 'manual_fallback', 'hybrid')),
  tank_detail JSONB,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_operation_hourly_cargo_progress_line_hour UNIQUE (load_line_id, hour_start)
);

CREATE INDEX IF NOT EXISTS idx_ohcp_operation_hour
  ON public.operation_hourly_cargo_progress (operation_id, hour_start);

COMMENT ON TABLE public.operation_hourly_cargo_progress IS
  'Persisted clock-hour cargo progress snapshots (survives tank_gauging_samples purge).';

CREATE TABLE IF NOT EXISTS public.operation_cargo_manual_checkpoints (
  id BIGSERIAL PRIMARY KEY,
  load_line_id BIGINT NOT NULL REFERENCES public.operation_cargo_load_lines(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL,
  cumulative_qty NUMERIC NOT NULL CHECK (cumulative_qty >= 0),
  remark TEXT,
  created_by BIGINT REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_cp_line_time
  ON public.operation_cargo_manual_checkpoints (load_line_id, recorded_at);

COMMENT ON TABLE public.operation_cargo_manual_checkpoints IS
  'Manual cumulative cargo readings when ATG is unavailable (hourly progress fallback).';
