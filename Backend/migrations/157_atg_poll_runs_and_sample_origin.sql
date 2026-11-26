-- ATG self-healing foundation: per-poll history and sample provenance.

BEGIN;

CREATE TABLE IF NOT EXISTS tank_gauging_poll_runs (
  id BIGSERIAL PRIMARY KEY,
  port_id BIGINT REFERENCES ports(id) ON DELETE SET NULL,
  source_id BIGINT REFERENCES tank_gauging_sources(id) ON DELETE SET NULL,
  source_base_url TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ok BOOLEAN NOT NULL,
  http_status INTEGER,
  fetched INTEGER NOT NULL DEFAULT 0,
  upserted INTEGER NOT NULL DEFAULT 0,
  unmapped INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_tank_gauging_poll_runs_source_started
  ON tank_gauging_poll_runs (source_base_url, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tank_gauging_poll_runs_started
  ON tank_gauging_poll_runs (started_at);

COMMENT ON TABLE tank_gauging_poll_runs IS
  'One row per Tankvision poll of one source (ok or failed). Pruned after 30 days by the purge job.';

ALTER TABLE tank_gauging_samples
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'live';

COMMENT ON COLUMN tank_gauging_samples.origin IS
  'live = stored by the poller; archive-backfill = imported later from the Tankvision archive.';

COMMIT;
