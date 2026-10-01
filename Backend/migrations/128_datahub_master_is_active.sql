-- JPS-only Active flag for DataHub-synced masters (vessel, term, commodity).
-- Inactive rows stay on Master pages and still receive hub updates; they are
-- hidden from SI / plan / partner pickers.

BEGIN;

ALTER TABLE master_vessels
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE si_trade_terms
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE si_commodities
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN master_vessels.is_active IS
  'JPS-only. When false, hide from operational vessel pickers. Not a DataHub field.';
COMMENT ON COLUMN si_trade_terms.is_active IS
  'JPS-only. When false, hide from SI/plan term dropdowns. Not a DataHub field.';
COMMENT ON COLUMN si_commodities.is_active IS
  'JPS-only. When false, hide from SI/plan commodity dropdowns. Not a DataHub field.';

COMMIT;
