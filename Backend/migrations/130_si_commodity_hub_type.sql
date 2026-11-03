-- DataHub raw commodity type vs JPS Solid/Liquid (operational type).

BEGIN;

ALTER TABLE si_commodities
  ADD COLUMN IF NOT EXISTS hub_type TEXT;

ALTER TABLE si_commodities
  ALTER COLUMN commodity_type DROP NOT NULL;

ALTER TABLE si_commodities
  ALTER COLUMN commodity_type DROP DEFAULT;

ALTER TABLE si_commodities
  DROP CONSTRAINT IF EXISTS chk_si_commodities_type;

ALTER TABLE si_commodities
  ADD CONSTRAINT chk_si_commodities_type
  CHECK (commodity_type IS NULL OR commodity_type IN ('Solid', 'Liquid'));

COMMENT ON COLUMN si_commodities.hub_type IS
  'Verbatim DataHub catalog type (e.g. Chemical, Fuel Greases and Lub). Synced from DHM; not used for JPS SI Solid/Liquid rules.';
COMMENT ON COLUMN si_commodities.commodity_type IS
  'JPS-only physical form: Solid or Liquid. Set manually; not overwritten by DataHub sync. NULL until user sets on hub-imported rows.';

COMMIT;
