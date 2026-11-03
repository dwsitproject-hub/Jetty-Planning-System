-- DHM port_master linkage on JPS operating ports (pull-only sync in v1).

BEGIN;

ALTER TABLE ports
  ADD COLUMN IF NOT EXISTS hub_code TEXT,
  ADD COLUMN IF NOT EXISTS hub_record_id UUID,
  ADD COLUMN IF NOT EXISTS hub_version INT,
  ADD COLUMN IF NOT EXISTS hub_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS datahub_last_apply_source TEXT,
  ADD COLUMN IF NOT EXISTS datahub_last_apply_run_id BIGINT,
  ADD COLUMN IF NOT EXISTS unlocode TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hub_site_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ports_hub_code_active
  ON ports (hub_code)
  WHERE deleted_at IS NULL AND hub_code IS NOT NULL;

COMMENT ON COLUMN ports.datahub_last_apply_source IS
  'webhook or manual_sync when last apply from datahub sync; null for local-only edits.';
COMMENT ON COLUMN ports.hub_site_id IS
  'DHM site reference from port_master sync; not shown in UI.';

ALTER TABLE datahub_vessel_sync_runs
  DROP CONSTRAINT IF EXISTS datahub_vessel_sync_runs_entity_type_check;

ALTER TABLE datahub_vessel_sync_runs
  ADD CONSTRAINT datahub_vessel_sync_runs_entity_type_check
  CHECK (entity_type IN ('vessel', 'incoterm', 'commodity', 'port_master'));

COMMIT;
