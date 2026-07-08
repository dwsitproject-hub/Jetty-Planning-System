-- Jetty Planning System - Migration 076
-- Persist uploaded SI source documents (PDF/images) for shipment plans / shipping instructions.

BEGIN;

CREATE TABLE IF NOT EXISTS shipping_instruction_documents (
  id BIGSERIAL PRIMARY KEY,
  port_id BIGINT NOT NULL REFERENCES ports(id) ON DELETE RESTRICT,
  shipment_plan_id BIGINT REFERENCES shipment_plans(id) ON DELETE CASCADE,
  shipping_instruction_id BIGINT REFERENCES shipping_instructions(id) ON DELETE CASCADE,
  draft_key TEXT,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  extract_json JSONB,
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_si_documents_plan_active
  ON shipping_instruction_documents(shipment_plan_id)
  WHERE deleted_at IS NULL AND shipment_plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_si_documents_si_active
  ON shipping_instruction_documents(shipping_instruction_id)
  WHERE deleted_at IS NULL AND shipping_instruction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_si_documents_draft_key_active
  ON shipping_instruction_documents(draft_key)
  WHERE deleted_at IS NULL AND draft_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_si_documents_port_active
  ON shipping_instruction_documents(port_id)
  WHERE deleted_at IS NULL;

COMMIT;
