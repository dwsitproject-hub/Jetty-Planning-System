-- ATG sample history for window rates + cargo_operations ATG rate columns.

BEGIN;

CREATE TABLE IF NOT EXISTS tank_gauging_samples (
  id BIGSERIAL PRIMARY KEY,
  tank_id BIGINT NOT NULL REFERENCES master_tanks(id) ON DELETE CASCADE,
  source_base_url TEXT NOT NULL,
  total_mass NUMERIC,
  flow_rate_tph NUMERIC,
  level_mm NUMERIC,
  temperature_c NUMERIC,
  status_text TEXT,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload JSONB
);

CREATE INDEX IF NOT EXISTS idx_tank_gauging_samples_tank_sampled
  ON tank_gauging_samples (tank_id, sampled_at DESC);

CREATE INDEX IF NOT EXISTS idx_tank_gauging_samples_sampled
  ON tank_gauging_samples (sampled_at DESC);

COMMENT ON TABLE tank_gauging_samples IS
  'Time-series ATG snapshots for computing mass-delta rates over activity windows.';

ALTER TABLE operation_operational_activities
  ADD COLUMN IF NOT EXISTS atg_flow_rate_tph NUMERIC;

ALTER TABLE operation_operational_activities
  ADD COLUMN IF NOT EXISTS atg_rate_detail JSONB;

ALTER TABLE operation_operational_activities
  ADD COLUMN IF NOT EXISTS atg_rate_computed_at TIMESTAMPTZ;

COMMENT ON COLUMN operation_operational_activities.atg_flow_rate_tph IS
  'Auto ATG hourly rate (sum |Δmass|/h across selected tanks) when activity end_at is set.';

COMMIT;
