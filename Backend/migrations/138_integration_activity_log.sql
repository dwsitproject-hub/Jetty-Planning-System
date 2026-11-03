-- Partner integration monitoring: inbound API request log + webhook delivery attempt metrics.
-- Contract: Docs/Guide/PARTNER-INTEGRATION-WEBHOOKS-ADMIN.md (Activity section).

BEGIN;

CREATE TABLE IF NOT EXISTS integration_api_request_logs (
  id BIGSERIAL PRIMARY KEY,
  api_key_id BIGINT REFERENCES integration_api_keys(id) ON DELETE SET NULL,
  key_prefix TEXT,
  request_id TEXT,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INT NOT NULL,
  duration_ms INT NOT NULL,
  error_code TEXT,
  external_reference TEXT,
  client_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE integration_api_request_logs IS
  'One row per partner API call (x-api-key). No headers or bodies stored. Purged by retention job.';

CREATE INDEX IF NOT EXISTS idx_integration_api_request_logs_created
  ON integration_api_request_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integration_api_request_logs_key_created
  ON integration_api_request_logs (api_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integration_api_request_logs_errors
  ON integration_api_request_logs (created_at DESC)
  WHERE status_code >= 400;

ALTER TABLE integration_webhook_deliveries
  ADD COLUMN IF NOT EXISTS last_http_status INT,
  ADD COLUMN IF NOT EXISTS last_duration_ms INT,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_integration_webhook_deliveries_created
  ON integration_webhook_deliveries (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integration_webhook_deliveries_status_created
  ON integration_webhook_deliveries (status, created_at DESC);

COMMIT;
