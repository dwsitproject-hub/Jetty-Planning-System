-- Rollback migration 076

BEGIN;

DROP TABLE IF EXISTS shipping_instruction_documents;

COMMIT;
