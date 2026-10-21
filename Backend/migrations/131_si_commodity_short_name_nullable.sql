-- Short name is JPS-only; hub sync does not set it (user fills in Master – Commodity).

BEGIN;

ALTER TABLE si_commodities
  ALTER COLUMN short_name DROP NOT NULL;

COMMENT ON COLUMN si_commodities.short_name IS
  'Abbreviation/code (e.g. CPO). JPS-only; not synced from DataHub. NULL until user sets on hub-imported rows.';

COMMIT;
