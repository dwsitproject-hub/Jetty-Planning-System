-- Kuras start point inside one cargo entry: the time cleaning (kuras) began, so one entry can
-- hold normal pumping first and kuras after. Auto = found from hourly ATG buckets with the port
-- Kuras rule; manual = set by the operator (kept across re-saves, never overwritten by auto).
-- Used only while FEATURE_NET_RATE is on. Rollback: Backend/rollback/155_rollback_cargo_line_kuras_start.sql

BEGIN;

ALTER TABLE public.operation_cargo_load_lines
  ADD COLUMN IF NOT EXISTS kuras_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kuras_start_source TEXT NOT NULL DEFAULT 'auto'
    CHECK (kuras_start_source IN ('auto', 'manual')),
  ADD COLUMN IF NOT EXISTS kuras_start_reason JSONB,
  ADD COLUMN IF NOT EXISTS kuras_start_set_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kuras_start_set_at TIMESTAMPTZ;

COMMENT ON COLUMN public.operation_cargo_load_lines.kuras_started_at IS
  'When kuras (cleaning) began inside this entry. NULL = no kuras found / operator said none.';
COMMENT ON COLUMN public.operation_cargo_load_lines.kuras_start_reason IS
  'Why auto picked this hour (remaining %, hourly rate, rule limits), or {"code":"manual"}.';

COMMIT;
