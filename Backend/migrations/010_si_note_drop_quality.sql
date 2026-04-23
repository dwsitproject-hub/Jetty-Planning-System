-- Jetty Planning System - Migration 010
-- Replace loading quality fields with a single note field.

BEGIN;

-- Add SI note (multiline free text)
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS note TEXT;

-- If legacy columns ever existed, drop them.
ALTER TABLE shipping_instructions DROP COLUMN IF EXISTS quality_ffa;
ALTER TABLE shipping_instructions DROP COLUMN IF EXISTS quality_mi;

COMMIT;

