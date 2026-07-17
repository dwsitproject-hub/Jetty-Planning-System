-- Rollback: collapse purpose-specific jetty_commodities back to single list per (jetty_id, commodity_id).
BEGIN;

-- Keep one row per jetty+commodity (prefer Unloading, then Loading).
DELETE FROM jetty_commodities jc
WHERE jc.operational_purpose = 'Loading'
  AND EXISTS (
    SELECT 1 FROM jetty_commodities jc2
    WHERE jc2.jetty_id = jc.jetty_id
      AND jc2.commodity_id = jc.commodity_id
      AND jc2.operational_purpose = 'Unloading'
  );

ALTER TABLE jetty_commodities DROP CONSTRAINT IF EXISTS jetty_commodities_pkey;

ALTER TABLE jetty_commodities
  ADD PRIMARY KEY (jetty_id, commodity_id);

ALTER TABLE jetty_commodities DROP CONSTRAINT IF EXISTS jetty_commodities_operational_purpose_check;

ALTER TABLE jetty_commodities DROP COLUMN IF EXISTS operational_purpose;

COMMIT;
