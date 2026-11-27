-- Rollback for 159_cargo_kuras_periods.sql: entries tagged mixed go back to Auto, periods are dropped.
BEGIN;

DROP TABLE IF EXISTS public.operation_cargo_kuras_periods;

UPDATE public.operation_cargo_load_lines
SET movement_type = NULL, movement_type_source = 'auto', movement_type_reason = NULL
WHERE movement_type = 'mixed';

ALTER TABLE public.operation_cargo_load_lines
  DROP CONSTRAINT IF EXISTS operation_cargo_load_lines_movement_type_check;
ALTER TABLE public.operation_cargo_load_lines
  ADD CONSTRAINT operation_cargo_load_lines_movement_type_check
  CHECK (movement_type IN ('normal', 'kuras'));

COMMIT;
