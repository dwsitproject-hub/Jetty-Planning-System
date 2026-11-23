-- Rollback migration 155: drop the kuras start columns. Only the split point is lost;
-- cargo entries, quantities and the whole-entry Normal/Kuras tag are untouched.

BEGIN;

ALTER TABLE public.operation_cargo_load_lines
  DROP COLUMN IF EXISTS kuras_start_set_at,
  DROP COLUMN IF EXISTS kuras_start_set_by,
  DROP COLUMN IF EXISTS kuras_start_reason,
  DROP COLUMN IF EXISTS kuras_start_source,
  DROP COLUMN IF EXISTS kuras_started_at;

DELETE FROM public.schema_migrations WHERE name = '155_cargo_line_kuras_start.sql';

COMMIT;
