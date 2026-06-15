-- Jetty Planning System - Migration 084
-- Inbound partner integration API: API keys + submission ledger.
-- See Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md.

BEGIN;

CREATE TABLE IF NOT EXISTS integration_api_keys (
  id BIGSERIAL PRIMARY KEY,
  partner_name TEXT NOT NULL,
  -- First characters of the plaintext key (e.g. 'jps_live_4f8a') so support can identify a key without storing it.
  key_prefix TEXT NOT NULL,
  -- SHA-256 hex digest of the full plaintext key; the plaintext is never stored.
  key_hash TEXT NOT NULL UNIQUE,
  allowed_port_ids BIGINT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ
);

COMMENT ON TABLE integration_api_keys IS
  'Per-partner API keys for the inbound integration API (x-api-key header).';

CREATE INDEX IF NOT EXISTS idx_integration_api_keys_active
  ON integration_api_keys (key_hash)
  WHERE active;

CREATE TABLE IF NOT EXISTS integration_submissions (
  id BIGSERIAL PRIMARY KEY,
  api_key_id BIGINT NOT NULL REFERENCES integration_api_keys(id) ON DELETE RESTRICT,
  external_reference TEXT NOT NULL,
  shipping_instruction_id BIGINT NOT NULL REFERENCES shipping_instructions(id) ON DELETE RESTRICT,
  shipment_plan_id BIGINT NOT NULL REFERENCES shipment_plans(id) ON DELETE RESTRICT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Idempotency: a partner may submit each external_reference exactly once.
  CONSTRAINT uq_integration_submissions_key_ref UNIQUE (api_key_id, external_reference)
);

COMMENT ON TABLE integration_submissions IS
  'Ledger of shipping instructions submitted through the inbound partner API; maps partner external_reference to JPS records.';

CREATE INDEX IF NOT EXISTS idx_integration_submissions_si
  ON integration_submissions (shipping_instruction_id);

COMMIT;
