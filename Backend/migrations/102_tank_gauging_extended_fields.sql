-- Extended Tankvision fields: product, comment, density, volume, tank metadata.

BEGIN;

ALTER TABLE tank_gauging_latest
  ADD COLUMN IF NOT EXISTS tank_comment TEXT,
  ADD COLUMN IF NOT EXISTS observed_density_kg_m3 NUMERIC,
  ADD COLUMN IF NOT EXISTS total_observed_volume NUMERIC,
  ADD COLUMN IF NOT EXISTS tank_status_code INT,
  ADD COLUMN IF NOT EXISTS level_movement INT,
  ADD COLUMN IF NOT EXISTS gauge_ref_height_mm NUMERIC;

COMMENT ON COLUMN tank_gauging_latest.tank_comment IS
  'Tankvision multiTankInfoData.tankComment (operational note from ATG).';

COMMENT ON COLUMN tank_gauging_latest.observed_density_kg_m3 IS
  'Tankvision PARAM 628 — observed density (kg/m³).';

COMMENT ON COLUMN tank_gauging_latest.total_observed_volume IS
  'Tankvision PARAM 717 — total observed volume (plant unit; typically m³ per NXA docs).';

ALTER TABLE tank_gauging_samples
  ADD COLUMN IF NOT EXISTS product_name TEXT,
  ADD COLUMN IF NOT EXISTS tank_comment TEXT,
  ADD COLUMN IF NOT EXISTS observed_density_kg_m3 NUMERIC,
  ADD COLUMN IF NOT EXISTS total_observed_volume NUMERIC;

COMMIT;
