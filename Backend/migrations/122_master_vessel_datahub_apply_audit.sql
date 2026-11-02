-- Track how the last DataHub-driven write reached master_vessels (webhook vs manual sync review).

ALTER TABLE master_vessels
  ADD COLUMN IF NOT EXISTS datahub_last_apply_source TEXT,
  ADD COLUMN IF NOT EXISTS datahub_last_apply_run_id BIGINT;

COMMENT ON COLUMN master_vessels.datahub_last_apply_source IS
  'webhook or manual_sync when last apply came from datahub_vessel_sync; null for local-only edits.';
COMMENT ON COLUMN master_vessels.datahub_last_apply_run_id IS
  'datahub_vessel_sync_runs.id for the apply that last updated this row from DataHub.';
