BEGIN;

ALTER TABLE tank_gauging_samples
  DROP COLUMN IF EXISTS total_observed_volume,
  DROP COLUMN IF EXISTS observed_density_kg_m3,
  DROP COLUMN IF EXISTS tank_comment,
  DROP COLUMN IF EXISTS product_name;

ALTER TABLE tank_gauging_latest
  DROP COLUMN IF EXISTS gauge_ref_height_mm,
  DROP COLUMN IF EXISTS level_movement,
  DROP COLUMN IF EXISTS tank_status_code,
  DROP COLUMN IF EXISTS total_observed_volume,
  DROP COLUMN IF EXISTS observed_density_kg_m3,
  DROP COLUMN IF EXISTS tank_comment;

COMMIT;
