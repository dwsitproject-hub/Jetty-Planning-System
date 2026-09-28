-- Partner integration webhooks (v5.0): endpoint registration + delivery outbox.
-- Contract: Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md v5.0

BEGIN;

CREATE TABLE IF NOT EXISTS integration_webhook_endpoints (
  id BIGSERIAL PRIMARY KEY,
  api_key_id BIGINT NOT NULL REFERENCES integration_api_keys(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  secret_prefix TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{*}'::TEXT[],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_webhook_endpoints_key_active
  ON integration_webhook_endpoints (api_key_id)
  WHERE active;

COMMENT ON TABLE integration_webhook_endpoints IS
  'Partner webhook URLs registered per integration API key. Secret is AES-encrypted at rest.';

CREATE TABLE IF NOT EXISTS integration_webhook_deliveries (
  id BIGSERIAL PRIMARY KEY,
  endpoint_id BIGINT NOT NULL REFERENCES integration_webhook_endpoints(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  si_id BIGINT NOT NULL,
  external_reference TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_integration_webhook_deliveries_pending
  ON integration_webhook_deliveries (status, next_attempt_at)
  WHERE status = 'pending';

COMMENT ON TABLE integration_webhook_deliveries IS
  'Outbound webhook outbox; at-least-once delivery with retries.';

COMMIT;
