-- Per-tank "Allow Manual Override": lets operators enter a quantity by hand for a tank
-- whose ATG connection is up but reading wrong. Off by default, requires a reason,
-- optional auto-off date. Changes are audited in activity_logs.

BEGIN;

ALTER TABLE public.master_tanks
  ADD COLUMN IF NOT EXISTS manual_override_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manual_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS manual_override_set_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_override_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_override_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.master_tanks.manual_override_enabled IS
  'When true (and not expired) cargo segments may take a manual quantity for this ATG tank.';

-- Quantities entered by hand for overridden tanks on a segment: { note, tanks: [{ tankId, qty }] }.
ALTER TABLE public.operation_cargo_load_lines
  ADD COLUMN IF NOT EXISTS manual_override JSONB;

COMMIT;
