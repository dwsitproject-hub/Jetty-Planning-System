-- Staged ATG sample lifecycle: archive after active retention, then hard-delete.
-- Audit each archive/delete action in tank_gauging_purge_log.

BEGIN;

ALTER TABLE tank_gauging_samples
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN tank_gauging_samples.archived_at IS
  'Set when sample exceeds active retention; hard-deleted after archive grace period.';

CREATE INDEX IF NOT EXISTS idx_tank_gauging_samples_archived
  ON tank_gauging_samples (archived_at)
  WHERE archived_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS tank_gauging_purge_log (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('archive', 'delete')),
  sample_id BIGINT,
  tank_id BIGINT,
  source_base_url TEXT,
  sampled_at TIMESTAMPTZ,
  total_mass NUMERIC,
  flow_rate_tph NUMERIC,
  level_mm NUMERIC,
  temperature_c NUMERIC,
  status_text TEXT,
  acted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tank_gauging_purge_log_acted
  ON tank_gauging_purge_log (acted_at DESC);

CREATE INDEX IF NOT EXISTS idx_tank_gauging_purge_log_batch
  ON tank_gauging_purge_log (batch_id);

COMMENT ON TABLE tank_gauging_purge_log IS
  'Audit of ATG sample archive/delete actions from the purge job (per-row detail).';

COMMIT;
