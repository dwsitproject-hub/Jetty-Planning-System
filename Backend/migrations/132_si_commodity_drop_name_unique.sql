-- Commodity long name (si_commodities.name) is not globally unique; hub_code is the sync identity.

BEGIN;

DROP INDEX IF EXISTS idx_si_commodities_name_active;

COMMENT ON COLUMN si_commodities.name IS
  'Display / long name (from DHM long_name when synced). May duplicate across rows; hub_code is the DataHub identity.';

COMMIT;
