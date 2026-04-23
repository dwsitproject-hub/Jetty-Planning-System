-- Standard rates: metric (KLPH | MTPH | MTPD) on each row; buffer removed (global SLA only).
-- Rename rate_per_hour -> rate_value (unit depends on rate_metric).

BEGIN;

ALTER TABLE standard_rates ADD COLUMN IF NOT EXISTS rate_metric TEXT;
UPDATE standard_rates SET rate_metric = 'MTPH' WHERE rate_metric IS NULL OR TRIM(rate_metric) = '';
ALTER TABLE standard_rates ALTER COLUMN rate_metric SET NOT NULL;
ALTER TABLE standard_rates DROP CONSTRAINT IF EXISTS standard_rates_rate_metric_check;
ALTER TABLE standard_rates ADD CONSTRAINT standard_rates_rate_metric_check
  CHECK (rate_metric IN ('KLPH', 'MTPH', 'MTPD'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'standard_rates' AND column_name = 'rate_per_hour'
  ) THEN
    ALTER TABLE public.standard_rates RENAME COLUMN rate_per_hour TO rate_value;
  END IF;
END $$;

ALTER TABLE standard_rates DROP COLUMN IF EXISTS buffer;

COMMIT;
