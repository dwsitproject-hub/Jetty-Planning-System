-- Jetty physical specs (master) + vessel dimensions (shipment_plans).
-- Required for new records via the API; columns stay nullable so legacy rows are unaffected.
-- vessel_dwt is a generated column: business rule DWT = gross tonnage + vessel capacity (MT).

BEGIN;

ALTER TABLE jetties
  ADD COLUMN IF NOT EXISTS jetty_length_m NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS jetty_draft NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS jetty_dwt NUMERIC(14,3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jetties_length_positive') THEN
    ALTER TABLE jetties ADD CONSTRAINT jetties_length_positive
      CHECK (jetty_length_m IS NULL OR jetty_length_m > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jetties_draft_positive') THEN
    ALTER TABLE jetties ADD CONSTRAINT jetties_draft_positive
      CHECK (jetty_draft IS NULL OR jetty_draft > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jetties_dwt_positive') THEN
    ALTER TABLE jetties ADD CONSTRAINT jetties_dwt_positive
      CHECK (jetty_dwt IS NULL OR jetty_dwt > 0);
  END IF;
END $$;

COMMENT ON COLUMN jetties.jetty_length_m IS 'Berth length in meters (master spec; required for new jetties via API).';
COMMENT ON COLUMN jetties.jetty_draft IS 'Maximum draft in meters (master spec; required for new jetties via API).';
COMMENT ON COLUMN jetties.jetty_dwt IS 'Maximum vessel DWT the jetty accepts (master spec; required for new jetties via API).';

ALTER TABLE shipment_plans
  ADD COLUMN IF NOT EXISTS vessel_loa_m NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS vessel_gross_tonnage NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS vessel_draft NUMERIC(10,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_plans_vessel_loa_positive') THEN
    ALTER TABLE shipment_plans ADD CONSTRAINT shipment_plans_vessel_loa_positive
      CHECK (vessel_loa_m IS NULL OR vessel_loa_m > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_plans_vessel_gt_positive') THEN
    ALTER TABLE shipment_plans ADD CONSTRAINT shipment_plans_vessel_gt_positive
      CHECK (vessel_gross_tonnage IS NULL OR vessel_gross_tonnage > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_plans_vessel_draft_positive') THEN
    ALTER TABLE shipment_plans ADD CONSTRAINT shipment_plans_vessel_draft_positive
      CHECK (vessel_draft IS NULL OR vessel_draft > 0);
  END IF;
END $$;

-- Business rule: Vessel DWT = Gross Tonnage + Vessel Capacity (MT). NULL while either input is missing.
ALTER TABLE shipment_plans
  ADD COLUMN IF NOT EXISTS vessel_dwt NUMERIC(15,3)
  GENERATED ALWAYS AS (vessel_gross_tonnage + vessel_capacity) STORED;

COMMENT ON COLUMN shipment_plans.vessel_loa_m IS 'Vessel length overall in meters (required on new plans via API).';
COMMENT ON COLUMN shipment_plans.vessel_gross_tonnage IS 'Vessel gross tonnage GT (required on new plans via API).';
COMMENT ON COLUMN shipment_plans.vessel_draft IS 'Vessel draft in meters (required on new plans via API).';
COMMENT ON COLUMN shipment_plans.vessel_dwt IS 'Generated: vessel_gross_tonnage + vessel_capacity (business rule).';

COMMIT;
