-- Rollback companion for 109_backfill_cargo_line_manual_qty_mode.sql
-- Restores the previous atg_qty_mode for every relabelled line, then drops the
-- backfill record. To re-apply afterwards, also remove the schema_migrations row
-- for '109_backfill_cargo_line_manual_qty_mode.sql'.

BEGIN;

UPDATE public.operation_cargo_load_lines l
SET atg_qty_mode = b.prev_atg_qty_mode
FROM public.operation_cargo_load_line_qty_mode_backfill b
WHERE b.load_line_id = l.id;

DROP TABLE IF EXISTS public.operation_cargo_load_line_qty_mode_backfill;

COMMIT;
