-- Add port-scoped loading/unloading rates (per commodity, per port).
-- Note: keep port_id nullable for backwards compatibility; Master UI will use active port_id.

BEGIN;

ALTER TABLE public.standard_rates
  ADD COLUMN IF NOT EXISTS port_id BIGINT REFERENCES public.ports(id),
  ADD COLUMN IF NOT EXISTS activity_type TEXT;

-- Default existing rows (legacy single-rate) to UNLOADING so they remain valid.
UPDATE public.standard_rates
SET activity_type = 'UNLOADING'
WHERE activity_type IS NULL OR TRIM(activity_type) = '';

ALTER TABLE public.standard_rates
  ALTER COLUMN activity_type SET NOT NULL;

ALTER TABLE public.standard_rates
  DROP CONSTRAINT IF EXISTS standard_rates_activity_type_check;

ALTER TABLE public.standard_rates
  ADD CONSTRAINT standard_rates_activity_type_check
  CHECK (activity_type IN ('LOADING', 'UNLOADING'));

-- One active rate per commodity x port x direction.
DROP INDEX IF EXISTS idx_standard_rates_commodity_port_activity_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_standard_rates_commodity_port_activity_active
  ON public.standard_rates (commodity_id, port_id, activity_type)
  WHERE deleted_at IS NULL;

COMMIT;

