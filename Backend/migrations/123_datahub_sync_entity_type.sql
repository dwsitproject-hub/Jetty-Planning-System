-- Support incoterm and commodity (and future) master sync on shared staging tables.

BEGIN;

ALTER TABLE datahub_vessel_sync_runs
  ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'vessel';

ALTER TABLE datahub_vessel_sync_runs
  DROP CONSTRAINT IF EXISTS datahub_vessel_sync_runs_entity_type_check;

ALTER TABLE datahub_vessel_sync_runs
  ADD CONSTRAINT datahub_vessel_sync_runs_entity_type_check
  CHECK (entity_type IN ('vessel', 'incoterm', 'commodity'));

COMMENT ON COLUMN datahub_vessel_sync_runs.entity_type IS
  'Which master entity this run stages: vessel, incoterm (Master Term), or commodity.';

CREATE INDEX IF NOT EXISTS idx_datahub_vessel_sync_runs_entity_status
  ON datahub_vessel_sync_runs (entity_type, status, started_at DESC);

COMMIT;
