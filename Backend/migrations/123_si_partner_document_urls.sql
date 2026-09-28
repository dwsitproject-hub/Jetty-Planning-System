-- Partner integration API v5.1: external document links on shipping instructions.

BEGIN;

ALTER TABLE shipping_instructions
  ADD COLUMN IF NOT EXISTS partner_si_document_url TEXT,
  ADD COLUMN IF NOT EXISTS partner_contract_document_url TEXT,
  ADD COLUMN IF NOT EXISTS partner_bl_document_url TEXT;

COMMENT ON COLUMN shipping_instructions.partner_si_document_url IS
  'Partner-provided HTTPS link to shipping instruction document (integration API).';
COMMENT ON COLUMN shipping_instructions.partner_contract_document_url IS
  'Partner-provided HTTPS link to contract document (integration API).';
COMMENT ON COLUMN shipping_instructions.partner_bl_document_url IS
  'Partner-provided HTTPS link to bill of lading document (integration API).';

COMMIT;
