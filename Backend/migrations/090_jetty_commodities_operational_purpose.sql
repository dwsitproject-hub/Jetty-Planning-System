-- Split jetty_commodities by operational purpose (Loading / Unloading).
BEGIN;

ALTER TABLE jetty_commodities
  ADD COLUMN IF NOT EXISTS operational_purpose TEXT NOT NULL DEFAULT 'Unloading';

ALTER TABLE jetty_commodities
  DROP CONSTRAINT IF EXISTS jetty_commodities_operational_purpose_check;

ALTER TABLE jetty_commodities
  ADD CONSTRAINT jetty_commodities_operational_purpose_check
  CHECK (operational_purpose IN ('Loading', 'Unloading'));

ALTER TABLE jetty_commodities DROP CONSTRAINT IF EXISTS jetty_commodities_pkey;

-- Existing rows remain Unloading; copy each to Loading (preserve capability for both purposes).
INSERT INTO jetty_commodities (jetty_id, commodity_id, operational_purpose, created_at)
SELECT jc.jetty_id, jc.commodity_id, 'Loading', jc.created_at
FROM jetty_commodities jc
WHERE jc.operational_purpose = 'Unloading'
ON CONFLICT DO NOTHING;

ALTER TABLE jetty_commodities
  ADD PRIMARY KEY (jetty_id, commodity_id, operational_purpose);

COMMENT ON COLUMN jetty_commodities.operational_purpose IS 'Loading or Unloading — commodities allowed for that operational purpose.';

COMMIT;
