-- Rollback companion for 100_tank_gauging_samples_and_activity_rate.sql

BEGIN;

ALTER TABLE operation_operational_activities
  DROP COLUMN IF EXISTS atg_rate_computed_at;

ALTER TABLE operation_operational_activities
  DROP COLUMN IF EXISTS atg_rate_detail;

ALTER TABLE operation_operational_activities
  DROP COLUMN IF EXISTS atg_flow_rate_tph;

DROP TABLE IF EXISTS tank_gauging_samples;

COMMIT;
