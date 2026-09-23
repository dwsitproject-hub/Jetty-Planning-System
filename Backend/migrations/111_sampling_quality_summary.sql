-- Sampling quality summary: the four values the "Update Quality CPO Incoming Barges"
-- report prints in its own summary box, alongside the per-palka FFA/Moisture rows.
--
-- These are the report's stated figures, not averages computed from the palka rows. The
-- two differ whenever a row is missing, and that gap is the signal operators rely on.
--
-- Only Pre-Checking 'sampling' rows populate these; every other sub-process leaves them
-- NULL, so all four are nullable.
--
-- Note: no BEGIN/COMMIT here — run-migrations.js wraps each file in a transaction.

ALTER TABLE public.operation_sub_processes
  ADD COLUMN IF NOT EXISTS ffa_average NUMERIC(7,3),
  ADD COLUMN IF NOT EXISTS moisture_average NUMERIC(7,3),
  ADD COLUMN IF NOT EXISTS dobi NUMERIC(7,3),
  ADD COLUMN IF NOT EXISTS iodine_value NUMERIC(7,3);

COMMENT ON COLUMN public.operation_sub_processes.ffa_average IS
  'Free fatty acid average (%) as stated on the quality report, not computed from palka rows.';

COMMENT ON COLUMN public.operation_sub_processes.moisture_average IS
  'Moisture average (%) as stated on the quality report, not computed from palka rows.';

COMMENT ON COLUMN public.operation_sub_processes.dobi IS
  'Deterioration of bleachability index as stated on the quality report.';

COMMENT ON COLUMN public.operation_sub_processes.iodine_value IS
  'Iodine value (g I2/100g) as stated on the quality report.';

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so drop first to keep this file re-runnable.
-- These bounds only reject nonsense; the usable ranges are enforced in the API so they can
-- be tightened without a migration.
ALTER TABLE public.operation_sub_processes
  DROP CONSTRAINT IF EXISTS operation_sub_processes_ffa_average_check;

ALTER TABLE public.operation_sub_processes
  ADD CONSTRAINT operation_sub_processes_ffa_average_check
  CHECK (ffa_average IS NULL OR (ffa_average >= 0 AND ffa_average <= 1000));

ALTER TABLE public.operation_sub_processes
  DROP CONSTRAINT IF EXISTS operation_sub_processes_moisture_average_check;

ALTER TABLE public.operation_sub_processes
  ADD CONSTRAINT operation_sub_processes_moisture_average_check
  CHECK (moisture_average IS NULL OR (moisture_average >= 0 AND moisture_average <= 1000));

ALTER TABLE public.operation_sub_processes
  DROP CONSTRAINT IF EXISTS operation_sub_processes_dobi_check;

ALTER TABLE public.operation_sub_processes
  ADD CONSTRAINT operation_sub_processes_dobi_check
  CHECK (dobi IS NULL OR (dobi >= 0 AND dobi <= 1000));

ALTER TABLE public.operation_sub_processes
  DROP CONSTRAINT IF EXISTS operation_sub_processes_iodine_value_check;

ALTER TABLE public.operation_sub_processes
  ADD CONSTRAINT operation_sub_processes_iodine_value_check
  CHECK (iodine_value IS NULL OR (iodine_value >= 0 AND iodine_value <= 1000));
