-- Allow a sync run that pulls one linked master row instead of the whole catalog.

BEGIN;

ALTER TABLE datahub_vessel_sync_runs
  DROP CONSTRAINT IF EXISTS datahub_vessel_sync_runs_source_check;

ALTER TABLE datahub_vessel_sync_runs
  ADD CONSTRAINT datahub_vessel_sync_runs_source_check
  CHECK (source IN ('manual', 'webhook', 'record'));

COMMENT ON COLUMN datahub_vessel_sync_runs.source IS
  'manual = full catalog pull; record = one linked row; webhook = DHM push.';

COMMIT;
