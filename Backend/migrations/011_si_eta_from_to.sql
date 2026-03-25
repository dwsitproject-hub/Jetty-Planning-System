-- Jetty Planning System - Migration 011
-- Add ETA From / ETA To to shipping_instructions and backfill from legacy eta.

BEGIN;

ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS eta_from DATE;
ALTER TABLE shipping_instructions ADD COLUMN IF NOT EXISTS eta_to DATE;

-- Backfill: if legacy eta exists, set both from/to to that date.
UPDATE shipping_instructions
SET
  eta_from = COALESCE(eta_from, (eta AT TIME ZONE 'UTC')::date),
  eta_to = COALESCE(eta_to, (eta AT TIME ZONE 'UTC')::date),
  updated_at = NOW()
WHERE deleted_at IS NULL AND eta IS NOT NULL AND (eta_from IS NULL OR eta_to IS NULL);

COMMIT;

