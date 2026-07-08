-- Jetty Planning System - Migration 085
-- Source tracing on shipment plans (integration API submissions).

BEGIN;

ALTER TABLE shipment_plans
  ADD COLUMN IF NOT EXISTS external_reference TEXT,
  ADD COLUMN IF NOT EXISTS requested_by TEXT;

COMMENT ON COLUMN shipment_plans.external_reference IS
  'Partner source document ID from the inbound integration API (e.g. EOS-EXPORT-2026-091).';
COMMENT ON COLUMN shipment_plans.requested_by IS
  'Person or service account in the source system who triggered the integration submission.';

CREATE INDEX IF NOT EXISTS idx_shipment_plans_external_reference
  ON shipment_plans (external_reference)
  WHERE external_reference IS NOT NULL AND deleted_at IS NULL;

COMMIT;
