-- Jetty Planning System - Migration 032
-- Remove hose_off_at from operations; clearance depart now uses cast_off_at only.

BEGIN;

ALTER TABLE operations
  DROP COLUMN IF EXISTS hose_off_at;

COMMIT;
