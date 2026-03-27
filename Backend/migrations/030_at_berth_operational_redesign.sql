-- Jetty Planning System - Migration 030
-- At-berth redesign:
-- - sub-processes support start/end and skipped reason
-- - operational activity supports cargo handling method lookup
-- - master table for cargo handling methods

BEGIN;

ALTER TABLE operation_sub_processes
  ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS skip_reason TEXT;

UPDATE operation_sub_processes
SET start_at = COALESCE(start_at, occurred_at),
    end_at = COALESCE(end_at, occurred_at)
WHERE occurred_at IS NOT NULL;

ALTER TABLE operation_sub_processes
  DROP CONSTRAINT IF EXISTS operation_sub_processes_status_check;

ALTER TABLE operation_sub_processes
  ADD CONSTRAINT operation_sub_processes_status_check
  CHECK (status IN ('Pending', 'In Progress', 'Done', 'Skipped', 'N/A'));

ALTER TABLE operation_sub_processes
  DROP CONSTRAINT IF EXISTS operation_sub_processes_time_range_check;

ALTER TABLE operation_sub_processes
  ADD CONSTRAINT operation_sub_processes_time_range_check
  CHECK (
    end_at IS NULL OR start_at IS NULL OR end_at >= start_at
  );

CREATE TABLE IF NOT EXISTS master_cargo_handling_methods (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

INSERT INTO master_cargo_handling_methods (code, name)
VALUES
  ('hose', 'Hose'),
  ('conveyor', 'Conveyor'),
  ('grab_bucket', 'Grab Bucket'),
  ('dump_truck', 'Dump Truck'),
  ('bucket_elevator', 'Bucket Elevator')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = TRUE,
  deleted_at = NULL,
  updated_at = NOW();

ALTER TABLE operation_operational_activities
  ADD COLUMN IF NOT EXISTS cargo_handling_method_id BIGINT REFERENCES master_cargo_handling_methods(id);

CREATE INDEX IF NOT EXISTS idx_operation_operational_activities_method
  ON operation_operational_activities(cargo_handling_method_id)
  WHERE deleted_at IS NULL;

COMMIT;

