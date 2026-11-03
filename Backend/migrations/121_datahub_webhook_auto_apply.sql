-- Auto-apply inbound DHM vessel webhooks (skip manual Master → Vessel review).

ALTER TABLE datahub_config
  ADD COLUMN IF NOT EXISTS webhook_auto_apply BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN datahub_config.webhook_auto_apply IS
  'When true with webhook_enabled, verified vessel webhooks apply to master_vessels immediately.';
