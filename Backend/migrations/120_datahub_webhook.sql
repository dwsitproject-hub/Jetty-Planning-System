-- Inbound DataHub (DHM) webhooks: receipt dedupe, config, sync run source.

BEGIN;

ALTER TABLE datahub_config
  ADD COLUMN IF NOT EXISTS webhook_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_webhook_error TEXT;

COMMENT ON COLUMN datahub_config.webhook_secret_encrypted IS
  'HMAC secret for inbound DHM webhooks (AES-256-GCM encrypted at rest).';
COMMENT ON COLUMN datahub_config.webhook_enabled IS
  'When true, POST /api/v1/datahub/webhook accepts verified DHM deliveries.';

ALTER TABLE datahub_vessel_sync_runs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS webhook_delivery_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'datahub_vessel_sync_runs_source_check'
  ) THEN
    ALTER TABLE datahub_vessel_sync_runs
      ADD CONSTRAINT datahub_vessel_sync_runs_source_check
      CHECK (source IN ('manual', 'webhook'));
  END IF;
END $$;

COMMENT ON COLUMN datahub_vessel_sync_runs.source IS 'manual = user pull sync; webhook = DHM push.';
COMMENT ON COLUMN datahub_vessel_sync_runs.webhook_delivery_id IS
  'X-DHM-Delivery-Id when source is webhook.';

CREATE TABLE IF NOT EXISTS datahub_webhook_receipts (
  id BIGSERIAL PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  event TEXT,
  entity_type TEXT,
  record_id TEXT,
  hub_code TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_run_id BIGINT REFERENCES datahub_vessel_sync_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'ignored', 'failed', 'duplicate')),
  error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_datahub_webhook_receipts_delivery_id
  ON datahub_webhook_receipts (delivery_id);

CREATE INDEX IF NOT EXISTS idx_datahub_webhook_receipts_received
  ON datahub_webhook_receipts (received_at DESC);

COMMENT ON TABLE datahub_webhook_receipts IS
  'Idempotency log for inbound DHM webhook deliveries (dedupe on delivery_id).';

COMMIT;
