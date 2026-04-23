-- Jetty Planning System - Migration 018
-- Allocation/Berthing: store No PKK on operations.

BEGIN;

ALTER TABLE operations ADD COLUMN IF NOT EXISTS no_pkk TEXT;

COMMIT;

