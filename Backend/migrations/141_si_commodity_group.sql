-- JPS-only commodity group for Management Dashboard rollup. Not synced from DataHub.

BEGIN;

ALTER TABLE si_commodities
  ADD COLUMN IF NOT EXISTS commodity_group TEXT;

COMMENT ON COLUMN si_commodities.commodity_group IS
  'JPS-only free text. Many commodities may share one group (e.g. CPO). Not synced from DataHub. Blank means the commodity stays its own row on the By Commodity dashboard.';

COMMIT;
