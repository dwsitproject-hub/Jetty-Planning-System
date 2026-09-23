-- Rollback migration 110: hourly cargo progress + manual checkpoints.

BEGIN;

DROP TABLE IF EXISTS public.operation_cargo_manual_checkpoints;
DROP TABLE IF EXISTS public.operation_hourly_cargo_progress;

ALTER TABLE public.operation_cargo_load_lines
  DROP COLUMN IF EXISTS atg_hourly_detail,
  DROP COLUMN IF EXISTS atg_hourly_computed_at;

ALTER TABLE public.ports
  DROP COLUMN IF EXISTS atg_flat_rate_threshold_tph,
  DROP COLUMN IF EXISTS atg_min_qty_moved_t;

COMMIT;
